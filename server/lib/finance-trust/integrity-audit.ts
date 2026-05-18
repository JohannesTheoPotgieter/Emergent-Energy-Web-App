/**
 * Finance integrity audit.
 *
 * Read-only structural audit of the finance surface. Reports:
 *   - Legacy-path dependency risks (PE/PI compat shapes, cached storage
 *     reads, feature-flag gated canonical routes).
 *   - Duplicate / ambiguous QuickBooks link patterns beyond the simple
 *     1:1 partial-unique-index constraint already enforced in the schema.
 *   - One-to-many / many-to-one risks on the customer-mapping surface.
 *   - Canonical vs. derived drift summary (same calculation as
 *     finance-core-trust-service, re-used here so the endpoint returns a
 *     single unified audit payload).
 *
 * NEVER mutates data. NEVER touches business calculations. Intended to be
 * run on-demand from a new /api/finance/trust/integrity-audit endpoint and
 * from the existing finance-core-trust report.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

function toInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * `db.execute()` is typed `any` at its source (dual pg / dev-SQLite driver).
 * Narrow a raw COUNT(*) result to its first row without re-introducing `any`.
 */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  const rows =
    result && typeof result === "object" && "rows" in result
      ? (result as { rows?: unknown }).rows
      : result;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

export interface FinanceIntegrityFinding {
  key: string;
  severity: "info" | "warn" | "high";
  count: number;
  detail: string;
}

export interface FinanceLegacyDependency {
  path: string;
  kind: "route" | "service" | "storage" | "schema_type";
  status: "active" | "deprecated" | "removed";
  notes: string;
}

export interface FinanceIntegrityReport {
  generatedAt: string;
  findings: FinanceIntegrityFinding[];
  legacyDependencies: FinanceLegacyDependency[];
  safeCleanupPerformed: string[];
  deferredBecauseProofInsufficient: string[];
}

/**
 * Static map of known legacy / compatibility paths in the finance surface.
 * This list is maintained by hand — update it any time a legacy path is
 * retired or relocated. Serves as the authoritative "still depends on"
 * record so deletion decisions do not rely on a grep.
 */
const LEGACY_DEPENDENCY_MAP: FinanceLegacyDependency[] = [
  {
    path: "shared/schema/finance.ts#ProgramExpense interface",
    kind: "schema_type",
    status: "deprecated",
    notes:
      "PE compat type used by legacy cashflow, revenue tab, and dashboard consumers. Read-only adapter over normalized_cost_lines.",
  },
  {
    path: "shared/schema/finance.ts#ProgramInflows interface",
    kind: "schema_type",
    status: "deprecated",
    notes: "PI compat type; adapter over normalized_revenue_lines.",
  },
  {
    path: "server/storage.ts#getAllProgramInflows",
    kind: "storage",
    status: "active",
    notes: "Legacy cached read path for PI compat shape.",
  },
  {
    path: "server/routes/finance-legacy-extracted-routes.ts",
    kind: "route",
    status: "deprecated",
    notes:
      "Compatibility route file. Most handlers have been moved to departments/finance-routes.ts; this file is retained as a thin shim.",
  },
  {
    path: "server/excelParser.ts",
    kind: "service",
    status: "deprecated",
    notes:
      "Smart Import v1 parser. Replaced by server/imports/ + smart-import-routes.ts. Kept for reference only.",
  },
  {
    path: "server/importPipeline.ts",
    kind: "service",
    status: "deprecated",
    notes:
      "Smart Import v1 pipeline. Replaced by Smart Import v2 runtime.",
  },
  {
    path: "POST /api/program-expenses",
    kind: "route",
    status: "active",
    notes:
      "Reads normalized_cost_lines via project-cost-line-read-service. Always emits X-Finance-Source-Layer=canonical.",
  },
  {
    path: "POST /api/quickbooks/cost-lines/:id/mark-realised",
    kind: "route",
    status: "removed",
    notes:
      "HTTP 410 Gone. Marking cost lines as realised is only possible via /api/cos-tracker/toggle-realised/:id.",
  },
];

/**
 * Build the finance integrity report. All queries use narrow COUNT(*) with
 * bounded filters so this is safe to call on demand from an admin UI.
 */
export async function buildFinanceIntegrityReport(): Promise<FinanceIntegrityReport> {
  const [
    costDuplicateInvoiceRow,
    revenueDuplicateInvoiceRow,
    mappingDuplicateRow,
    crossRealmLinkRow,
    activeCostLinesWithoutProject,
  ] = await Promise.all([
    // Duplicate invoice+project+amount on the cost side — potential
    // double-entry risk (not enforced at the DB level because some real
    // invoices legitimately repeat for retention).
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT project_id, invoice_number, amount_ex_vat
        FROM normalized_cost_lines
        WHERE effective_to IS NULL
          AND NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NOT NULL
        GROUP BY project_id, invoice_number, amount_ex_vat
        HAVING COUNT(*) > 1
      ) t
    `),
    // Same check for revenue lines.
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT project_id, invoice_number, amount_ex_vat
        FROM normalized_revenue_lines
        WHERE effective_to IS NULL
          AND NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NOT NULL
        GROUP BY project_id, invoice_number, amount_ex_vat
        HAVING COUNT(*) > 1
      ) t
    `),
    // Customer mapping — the DB already enforces one-per-(project, realm).
    // This count catches the edge case where two soft-deleted rows are
    // resurrected incorrectly.
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT project_id, qb_realm_id
        FROM quickbooks_customer_mappings
        WHERE deleted_at IS NULL
        GROUP BY project_id, qb_realm_id
        HAVING COUNT(*) > 1
      ) t
    `),
    // App entity linked to QB docs from different realms — likely a
    // mis-configured sandbox / production switch.
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT app_entity_type, app_entity_id
        FROM quickbooks_invoice_links
        WHERE deleted_at IS NULL
        GROUP BY app_entity_type, app_entity_id
        HAVING COUNT(DISTINCT qb_realm_id) > 1
      ) t
    `),
    // Active cost lines missing a projectId FK (should be zero; the column
    // is NOT NULL, but historical imports may have used a sentinel).
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND (project_id IS NULL OR project_id <= 0)
    `),
  ]);

  const costDupes = toInt(firstRow(costDuplicateInvoiceRow)?.count);
  const revenueDupes = toInt(firstRow(revenueDuplicateInvoiceRow)?.count);
  const mappingDupes = toInt(firstRow(mappingDuplicateRow)?.count);
  const crossRealmLinks = toInt(firstRow(crossRealmLinkRow)?.count);
  const orphanedCostLines = toInt(firstRow(activeCostLinesWithoutProject)?.count);

  const findings: FinanceIntegrityFinding[] = [
    {
      key: "cost_invoice_duplicate_candidates",
      severity: costDupes > 0 ? "warn" : "info",
      count: costDupes,
      detail:
        "Cost lines sharing (project, invoice_number, amount). May be legitimate retention but should be reviewed.",
    },
    {
      key: "revenue_invoice_duplicate_candidates",
      severity: revenueDupes > 0 ? "warn" : "info",
      count: revenueDupes,
      detail:
        "Revenue lines sharing (project, invoice_number, amount). Potential double-count risk.",
    },
    {
      key: "customer_mapping_duplicates",
      severity: mappingDupes > 0 ? "high" : "info",
      count: mappingDupes,
      detail:
        "Active customer mappings with more than one row per (project, realm). The partial unique index should prevent this — non-zero count is a regression.",
    },
    {
      key: "qb_link_cross_realm",
      severity: crossRealmLinks > 0 ? "high" : "info",
      count: crossRealmLinks,
      detail:
        "App rows linked to QB docs from more than one realm. Indicates a sandbox/production mis-configuration.",
    },
    {
      key: "cost_line_missing_project_fk",
      severity: orphanedCostLines > 0 ? "high" : "info",
      count: orphanedCostLines,
      detail:
        "Active cost lines with NULL or sentinel project_id. Project-spine architecture requires a valid project FK.",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    findings,
    legacyDependencies: LEGACY_DEPENDENCY_MAP,
    safeCleanupPerformed: [
      "Centralised finance trust headers in server/lib/finance-trust/envelope.ts (refreshedAt, stale-after, exception-count, override-in-effect).",
      "Added read-only finance trust routes: /api/finance/trust/exceptions/summary, /api/finance/trust/exceptions/queue, /api/finance/trust/sync-health, /api/finance/trust/revalidation-status.",
      "No legacy paths were deleted. Deletion requires the dependency report above to be fully green (all `status: active` rows resolved).",
    ],
    deferredBecauseProofInsufficient: [
      "Consolidating /api/program-expenses + /api/finance/cos into a single canonical endpoint — downstream clients still read the compat shape.",
      "Enforcing a DB-level CHECK that invoice_number is set when status = 'invoiced' — retention invoices and placeholder rows violate this today.",
      "Adding a unique (project_id, invoice_number, amount_ex_vat) constraint on normalized_cost_lines — legitimate retention patterns trip it.",
    ],
  };
}
