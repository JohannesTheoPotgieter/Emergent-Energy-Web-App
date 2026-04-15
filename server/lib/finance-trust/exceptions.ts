/**
 * Finance exception / red-flag query helpers.
 *
 * Lightweight read-only counts and lists used by
 *  - /api/finance/exceptions/summary  (counts only, no row detail)
 *  - /api/finance/exceptions/queue    (top-N row detail per category)
 *
 * All queries MUST honour the snapshot `effective_to IS NULL` guard so
 * historical rows are never double-counted. This module does NOT mutate
 * data and does NOT change any business rules.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const DEFAULT_QUEUE_LIMIT = 50;

function toInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export interface FinanceExceptionSummary {
  generatedAt: string;
  /** Cost lines with an invoice_number but no po_number. */
  missingPoInvoices: number;
  /** Active cost lines missing source_sheet or source_row lineage. */
  costMissingSourceLineage: number;
  /** Active revenue lines missing source lineage. */
  revenueMissingSourceLineage: number;
  /**
   * Cost lines flagged as realised from an invoice but with no confirmed
   * QuickBooks bill link. These are "unmatched invoices" from a
   * reconciliation standpoint.
   */
  unmatchedCostInvoices: number;
  /** Revenue lines with a received payment but no confirmed QB invoice link. */
  unmatchedRevenuePayments: number;
  /**
   * QB link duplicate / ambiguity candidates: app rows that have at least
   * one active link AND at least one soft-deleted link in the same realm.
   * Flags rows where reconcilers bounced between candidate matches.
   */
  duplicateLinkCandidates: number;
  /** Active admin overrides on normalized cost lines. */
  costOverridesInEffect: number;
  /** Active admin overrides on normalized revenue lines. */
  revenueOverridesInEffect: number;
  /**
   * finance_cos_monthly rows whose derived value diverges from the
   * canonical invoice-based aggregation (>0.01 ex VAT).
   */
  cosDerivationDriftRows: number;
  /** Total exception count — sum of all red-flag buckets. */
  totalExceptionCount: number;
}

/**
 * Build an aggregate finance exception summary. Single round-trip per
 * category — query plans are simple COUNT(*) with narrow filters.
 */
export async function getFinanceExceptionSummary(): Promise<FinanceExceptionSummary> {
  const [
    missingPo,
    costLineage,
    revLineage,
    unmatchedCostInvoicesRow,
    unmatchedRevenueRow,
    duplicateRow,
    costOverrideRow,
    revenueOverrideRow,
    driftRow,
  ] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(po_number, '')), '') IS NULL
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND (source_sheet IS NULL OR source_row IS NULL)
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_revenue_lines
      WHERE effective_to IS NULL
        AND (source_sheet IS NULL OR source_row IS NULL)
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_cost_lines c
      WHERE c.effective_to IS NULL
        AND NULLIF(TRIM(COALESCE(c.invoice_number, '')), '') IS NOT NULL
        AND c.invoice_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM quickbooks_invoice_links l
          WHERE l.deleted_at IS NULL
            AND l.app_entity_type = 'cost_line'
            AND l.app_entity_id = c.id
        )
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_revenue_lines r
      WHERE r.effective_to IS NULL
        AND r.paid_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM quickbooks_invoice_links l
          WHERE l.deleted_at IS NULL
            AND l.app_entity_type = 'revenue_line'
            AND l.app_entity_id = r.id
        )
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT app_entity_type, app_entity_id, qb_realm_id
        FROM quickbooks_invoice_links
        GROUP BY app_entity_type, app_entity_id, qb_realm_id
        HAVING COUNT(*) FILTER (WHERE deleted_at IS NULL) >= 1
           AND COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) >= 1
      ) t
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_cost_lines
      WHERE effective_to IS NULL
        AND (
          admin_date_override IS NOT NULL
          OR cos_status_override IS NOT NULL
        )
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM normalized_revenue_lines
      WHERE effective_to IS NULL
        AND admin_date_override IS NOT NULL
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
      SELECT COUNT(*)::int AS count
      FROM realised r
      FULL OUTER JOIN monthly m
        ON r.project_id = m.project_id
       AND r.month_end_date = m.month_end_date
      WHERE ABS(COALESCE(r.canonical_value, 0) - COALESCE(m.monthly_value, 0)) > 0.01
    `),
  ]);

  const missingPoInvoices = toInt((missingPo.rows[0] as any)?.count);
  const costMissingSourceLineage = toInt((costLineage.rows[0] as any)?.count);
  const revenueMissingSourceLineage = toInt((revLineage.rows[0] as any)?.count);
  const unmatchedCostInvoices = toInt((unmatchedCostInvoicesRow.rows[0] as any)?.count);
  const unmatchedRevenuePayments = toInt((unmatchedRevenueRow.rows[0] as any)?.count);
  const duplicateLinkCandidates = toInt((duplicateRow.rows[0] as any)?.count);
  const costOverridesInEffect = toInt((costOverrideRow.rows[0] as any)?.count);
  const revenueOverridesInEffect = toInt((revenueOverrideRow.rows[0] as any)?.count);
  const cosDerivationDriftRows = toInt((driftRow.rows[0] as any)?.count);

  const totalExceptionCount =
    missingPoInvoices +
    costMissingSourceLineage +
    revenueMissingSourceLineage +
    unmatchedCostInvoices +
    unmatchedRevenuePayments +
    duplicateLinkCandidates +
    cosDerivationDriftRows;

  return {
    generatedAt: new Date().toISOString(),
    missingPoInvoices,
    costMissingSourceLineage,
    revenueMissingSourceLineage,
    unmatchedCostInvoices,
    unmatchedRevenuePayments,
    duplicateLinkCandidates,
    costOverridesInEffect,
    revenueOverridesInEffect,
    cosDerivationDriftRows,
    totalExceptionCount,
  };
}

export interface FinanceExceptionQueueRow {
  category:
    | "missing_po"
    | "unmatched_cost_invoice"
    | "unmatched_revenue_payment"
    | "duplicate_link_candidate"
    | "cost_override"
    | "revenue_override";
  costLineId?: number | null;
  revenueLineId?: number | null;
  projectId: number | null;
  projectName: string | null;
  invoiceNumber: string | null;
  poNumber: string | null;
  amount: string | null;
  asOfDate: string | null;
  note: string | null;
}

/**
 * Return a top-N exception list per category, for the reconciliation
 * exception queue UI. Row volume is intentionally bounded — this endpoint
 * is for triage, not bulk export. Callers hitting the limit must paginate
 * by category.
 */
export async function getFinanceExceptionQueue(limitPerCategory = DEFAULT_QUEUE_LIMIT): Promise<{
  generatedAt: string;
  limitPerCategory: number;
  rows: FinanceExceptionQueueRow[];
}> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limitPerCategory)));

  const [missingPo, unmatchedCost, unmatchedRev, duplicates, costOverride, revOverride] =
    await Promise.all([
      db.execute(sql`
        SELECT id, project_id, project_name, invoice_number, po_number,
               amount_ex_vat, invoice_date
        FROM normalized_cost_lines
        WHERE effective_to IS NULL
          AND NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(po_number, '')), '') IS NULL
        ORDER BY invoice_date DESC NULLS LAST, id DESC
        LIMIT ${safeLimit}
      `),
      db.execute(sql`
        SELECT c.id, c.project_id, c.project_name, c.invoice_number, c.po_number,
               c.amount_ex_vat, c.invoice_date
        FROM normalized_cost_lines c
        WHERE c.effective_to IS NULL
          AND NULLIF(TRIM(COALESCE(c.invoice_number, '')), '') IS NOT NULL
          AND c.invoice_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM quickbooks_invoice_links l
            WHERE l.deleted_at IS NULL
              AND l.app_entity_type = 'cost_line'
              AND l.app_entity_id = c.id
          )
        ORDER BY c.invoice_date DESC NULLS LAST, c.id DESC
        LIMIT ${safeLimit}
      `),
      db.execute(sql`
        SELECT r.id, r.project_id, r.project_name, r.invoice_number,
               r.amount_ex_vat, r.paid_date
        FROM normalized_revenue_lines r
        WHERE r.effective_to IS NULL
          AND r.paid_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM quickbooks_invoice_links l
            WHERE l.deleted_at IS NULL
              AND l.app_entity_type = 'revenue_line'
              AND l.app_entity_id = r.id
          )
        ORDER BY r.paid_date DESC NULLS LAST, r.id DESC
        LIMIT ${safeLimit}
      `),
      db.execute(sql`
        SELECT app_entity_type, app_entity_id, qb_realm_id,
               COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS active_count,
               COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted_count
        FROM quickbooks_invoice_links
        GROUP BY app_entity_type, app_entity_id, qb_realm_id
        HAVING COUNT(*) FILTER (WHERE deleted_at IS NULL) >= 1
           AND COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) >= 1
        ORDER BY app_entity_id DESC
        LIMIT ${safeLimit}
      `),
      db.execute(sql`
        SELECT id, project_id, project_name, invoice_number, po_number,
               amount_ex_vat, admin_date_override,
               admin_date_override_reason, cos_status_override,
               cos_status_override_reason
        FROM normalized_cost_lines
        WHERE effective_to IS NULL
          AND (admin_date_override IS NOT NULL
               OR cos_status_override IS NOT NULL)
        ORDER BY id DESC
        LIMIT ${safeLimit}
      `),
      db.execute(sql`
        SELECT id, project_id, project_name, invoice_number,
               amount_ex_vat, admin_date_override, admin_date_override_reason
        FROM normalized_revenue_lines
        WHERE effective_to IS NULL
          AND admin_date_override IS NOT NULL
        ORDER BY id DESC
        LIMIT ${safeLimit}
      `),
    ]);

  const rows: FinanceExceptionQueueRow[] = [];

  for (const raw of missingPo.rows as any[]) {
    rows.push({
      category: "missing_po",
      costLineId: toInt(raw.id),
      projectId: raw.project_id !== null && raw.project_id !== undefined ? toInt(raw.project_id) : null,
      projectName: toStr(raw.project_name),
      invoiceNumber: toStr(raw.invoice_number),
      poNumber: toStr(raw.po_number),
      amount: toStr(raw.amount_ex_vat),
      asOfDate: toStr(raw.invoice_date),
      note: "Invoice has no PO — procurement red flag.",
    });
  }

  for (const raw of unmatchedCost.rows as any[]) {
    rows.push({
      category: "unmatched_cost_invoice",
      costLineId: toInt(raw.id),
      projectId: raw.project_id !== null && raw.project_id !== undefined ? toInt(raw.project_id) : null,
      projectName: toStr(raw.project_name),
      invoiceNumber: toStr(raw.invoice_number),
      poNumber: toStr(raw.po_number),
      amount: toStr(raw.amount_ex_vat),
      asOfDate: toStr(raw.invoice_date),
      note: "Realised cost invoice has no confirmed QuickBooks bill link.",
    });
  }

  for (const raw of unmatchedRev.rows as any[]) {
    rows.push({
      category: "unmatched_revenue_payment",
      revenueLineId: toInt(raw.id),
      projectId: raw.project_id !== null && raw.project_id !== undefined ? toInt(raw.project_id) : null,
      projectName: toStr(raw.project_name),
      invoiceNumber: toStr(raw.invoice_number),
      poNumber: null,
      amount: toStr(raw.amount_ex_vat),
      asOfDate: toStr(raw.paid_date),
      note: "Received payment has no confirmed QuickBooks invoice link.",
    });
  }

  for (const raw of duplicates.rows as any[]) {
    const entityType = toStr(raw.app_entity_type);
    const entityId = toInt(raw.app_entity_id);
    rows.push({
      category: "duplicate_link_candidate",
      costLineId: entityType === "cost_line" ? entityId : null,
      revenueLineId: entityType === "revenue_line" ? entityId : null,
      projectId: null,
      projectName: null,
      invoiceNumber: null,
      poNumber: null,
      amount: null,
      asOfDate: null,
      note: `App ${entityType ?? "row"} has ${toInt(raw.active_count)} active + ${toInt(raw.deleted_count)} historical QB links — ambiguous.`,
    });
  }

  for (const raw of costOverride.rows as any[]) {
    rows.push({
      category: "cost_override",
      costLineId: toInt(raw.id),
      projectId: raw.project_id !== null && raw.project_id !== undefined ? toInt(raw.project_id) : null,
      projectName: toStr(raw.project_name),
      invoiceNumber: toStr(raw.invoice_number),
      poNumber: toStr(raw.po_number),
      amount: toStr(raw.amount_ex_vat),
      asOfDate: toStr(raw.admin_date_override),
      note:
        toStr(raw.admin_date_override_reason) ??
        toStr(raw.cos_status_override_reason) ??
        "Manual admin override in effect.",
    });
  }

  for (const raw of revOverride.rows as any[]) {
    rows.push({
      category: "revenue_override",
      revenueLineId: toInt(raw.id),
      projectId: raw.project_id !== null && raw.project_id !== undefined ? toInt(raw.project_id) : null,
      projectName: toStr(raw.project_name),
      invoiceNumber: toStr(raw.invoice_number),
      poNumber: null,
      amount: toStr(raw.amount_ex_vat),
      asOfDate: toStr(raw.admin_date_override),
      note: toStr(raw.admin_date_override_reason) ?? "Manual admin override in effect.",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    limitPerCategory: safeLimit,
    rows,
  };
}
