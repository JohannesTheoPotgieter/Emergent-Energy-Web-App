/**
 * Batch Bridge Sync — Post-transaction bridge reconciliation
 *
 * For bulk write paths (smart-import, subcontractor rebuild, etc.) where
 * per-row bridge calls inside transactions are impractical, this module
 * provides batch sync functions that reconcile all unsynced rows from
 * legacy tables to their promoted counterparts.
 *
 * Call these AFTER a transaction commits successfully.
 * All operations are best-effort and non-blocking.
 * Uses cursor-based pagination to handle any data volume.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { syncCostLine, syncRevenueLine, syncChangeRequest, type BridgeResult } from "./bridge-writer";

const PAGE_SIZE = 500;
const MAX_PAGES = 20; // Safety limit: 10,000 rows max per call

// Concurrency guard: prevent overlapping batch syncs for the same project
const activeSyncs = new Set<string>();

function acquireLock(key: string): boolean {
  if (activeSyncs.has(key)) return false;
  activeSyncs.add(key);
  return true;
}

function releaseLock(key: string): void {
  activeSyncs.delete(key);
}

// ---------------------------------------------------------------------------
// Batch sync: cost lines that have no corresponding finance.cost_lines row
// ---------------------------------------------------------------------------

export async function batchSyncCostLinesByProject(
  projectId: number | null,
  projectName: string | null,
): Promise<{ synced: number; failed: number }> {
  const lockKey = `cost:${projectId ?? projectName}`;
  if (!acquireLock(lockKey)) {
    console.log(`[batch-bridge-sync] skipping cost sync — already in progress for ${lockKey}`);
    return { synced: 0, failed: 0 };
  }

  let totalSynced = 0;
  let totalFailed = 0;

  try {
    const condition = projectId
      ? sql`ncl.project_id = ${projectId}`
      : sql`ncl.project_name = ${projectName}`;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const rows = await db.execute(sql`
        SELECT ncl.id, ncl.project_name, ncl.project_id,
               ncl.counterparty_name, ncl.description, ncl.amount_ex_vat,
               ncl.invoice_number, ncl.invoice_date, ncl.approved_date, ncl.paid_date,
               ncl.cost_line_status, ncl.import_run_id, ncl.cost_category, ncl.po_number
        FROM normalized_cost_lines ncl
        LEFT JOIN finance.cost_lines fcl ON fcl.legacy_normalized_cost_line_id = ncl.id
        WHERE ${condition}
          AND ncl.effective_to IS NULL
          AND (fcl.id IS NULL OR fcl.updated_at < ncl.updated_at)
        ORDER BY ncl.id
        LIMIT ${PAGE_SIZE}
        OFFSET ${offset}
      `);

      const unsynced = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      if (unsynced.length === 0) break;

      for (const r of unsynced as any[]) {
        const result = await syncCostLine({
          id: r.id,
          projectName: r.project_name,
          projectId: r.project_id,
          counterpartyName: r.counterparty_name,
          description: r.description,
          amountExVat: r.amount_ex_vat,
          invoiceNumber: r.invoice_number,
          invoiceDate: r.invoice_date,
          approvedDate: r.approved_date,
          paidDate: r.paid_date,
          status: r.cost_line_status,
          importRunId: r.import_run_id,
          costCategory: r.cost_category,
          poNumber: r.po_number,
        });
        if (result.success) totalSynced++;
        else totalFailed++;
      }

      if (unsynced.length < PAGE_SIZE) break; // Last page
    }

    return { synced: totalSynced, failed: totalFailed };
  } catch (err) {
    console.error("[batch-bridge-sync] cost lines error:", err instanceof Error ? err.message : String(err));
    return { synced: totalSynced, failed: totalFailed };
  } finally {
    releaseLock(lockKey);
  }
}

// ---------------------------------------------------------------------------
// Batch sync: revenue lines that have no corresponding finance.revenue_lines row
// ---------------------------------------------------------------------------

export async function batchSyncRevenueLinesByProject(
  projectId: number | null,
  projectName: string | null,
): Promise<{ synced: number; failed: number }> {
  const lockKey = `revenue:${projectId ?? projectName}`;
  if (!acquireLock(lockKey)) {
    console.log(`[batch-bridge-sync] skipping revenue sync — already in progress for ${lockKey}`);
    return { synced: 0, failed: 0 };
  }

  let totalSynced = 0;
  let totalFailed = 0;

  try {
    const condition = projectId
      ? sql`nrl.project_id = ${projectId}`
      : sql`nrl.project_name = ${projectName}`;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const rows = await db.execute(sql`
        SELECT nrl.id, nrl.project_name, nrl.project_id,
               nrl.milestone_name, nrl.amount_ex_vat,
               nrl.invoice_number, nrl.invoice_date, nrl.expected_payment_date, nrl.paid_date,
               nrl.status, nrl.import_run_id, nrl.description
        FROM normalized_revenue_lines nrl
        LEFT JOIN finance.revenue_lines frl ON frl.legacy_normalized_revenue_line_id = nrl.id
        WHERE ${condition}
          AND nrl.effective_to IS NULL
          AND (frl.id IS NULL OR frl.updated_at < nrl.updated_at)
        ORDER BY nrl.id
        LIMIT ${PAGE_SIZE}
        OFFSET ${offset}
      `);

      const unsynced = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      if (unsynced.length === 0) break;

      for (const r of unsynced as any[]) {
        const result = await syncRevenueLine({
          id: r.id,
          projectName: r.project_name,
          projectId: r.project_id,
          milestoneName: r.milestone_name,
          amountExVat: r.amount_ex_vat,
          invoiceNumber: r.invoice_number,
          invoiceDate: r.invoice_date,
          expectedPaymentDate: r.expected_payment_date,
          paidDate: r.paid_date,
          status: r.status,
          importRunId: r.import_run_id,
          description: r.description,
        });
        if (result.success) totalSynced++;
        else totalFailed++;
      }

      if (unsynced.length < PAGE_SIZE) break;
    }

    return { synced: totalSynced, failed: totalFailed };
  } catch (err) {
    console.error("[batch-bridge-sync] revenue lines error:", err instanceof Error ? err.message : String(err));
    return { synced: totalSynced, failed: totalFailed };
  } finally {
    releaseLock(lockKey);
  }
}

// ---------------------------------------------------------------------------
// Batch sync: change requests missing from finance.finance_records
// ---------------------------------------------------------------------------

export async function batchSyncChangeRequestsByProject(
  projectId: number | null,
): Promise<{ synced: number; failed: number }> {
  if (!projectId) return { synced: 0, failed: 0 };

  const lockKey = `cr:${projectId}`;
  if (!acquireLock(lockKey)) return { synced: 0, failed: 0 };

  let totalSynced = 0;
  let totalFailed = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const rows = await db.execute(sql`
        SELECT cr.id, cr.project_id, cr.title, cr.change_type, cr.status,
               cr.cost_impact, cr.revenue_impact, cr.cos_impact, cr.margin_impact,
               cr.cause, cr.client_linked, cr.impact_summary, cr.evidence_link
        FROM change_requests cr
        LEFT JOIN finance.finance_records fr
          ON fr.legacy_entity_table = 'public.change_requests' AND fr.legacy_entity_id = cr.id
        WHERE cr.project_id = ${projectId}
          AND cr.deleted_at IS NULL
          AND (fr.id IS NULL OR fr.updated_at < cr.updated_at)
        ORDER BY cr.id
        LIMIT ${PAGE_SIZE}
        OFFSET ${offset}
      `);

      const unsynced = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      if (unsynced.length === 0) break;

      for (const r of unsynced as any[]) {
        const result = await syncChangeRequest({
          id: r.id,
          projectId: r.project_id,
          title: r.title,
          changeType: r.change_type,
          status: r.status,
          costImpact: r.cost_impact,
          revenueImpact: r.revenue_impact,
          cosImpact: r.cos_impact,
          marginImpact: r.margin_impact,
          cause: r.cause,
          clientLinked: r.client_linked,
          impactSummary: r.impact_summary,
          evidenceLink: r.evidence_link,
        });
        if (result.success) totalSynced++;
        else totalFailed++;
      }

      if (unsynced.length < PAGE_SIZE) break;
    }

    return { synced: totalSynced, failed: totalFailed };
  } catch (err) {
    console.error("[batch-bridge-sync] change requests error:", err instanceof Error ? err.message : String(err));
    return { synced: totalSynced, failed: totalFailed };
  } finally {
    releaseLock(lockKey);
  }
}

// ---------------------------------------------------------------------------
// Combined sync for a project (after import completes)
// ---------------------------------------------------------------------------

export async function batchSyncFinanceByProject(
  projectId: number | null,
  projectName: string | null,
): Promise<{ costs: { synced: number; failed: number }; revenue: { synced: number; failed: number } }> {
  const [costs, revenue] = await Promise.all([
    batchSyncCostLinesByProject(projectId, projectName),
    batchSyncRevenueLinesByProject(projectId, projectName),
  ]);

  if (costs.synced + revenue.synced > 0) {
    console.log(`[batch-bridge-sync] project=${projectName ?? projectId}: costs=${costs.synced}/${costs.synced + costs.failed}, revenue=${revenue.synced}/${revenue.synced + revenue.failed}`);
  }

  return { costs, revenue };
}
