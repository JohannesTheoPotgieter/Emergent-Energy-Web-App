/**
 * Bridge Writer — Phase 2 dual-write module
 *
 * Propagates legacy table writes to promoted schema tables.
 * All bridge writes are best-effort: failures are logged but never
 * block the legacy write. Staleness is detected by reconciliation
 * via the last_synced_at column.
 *
 * Each sync method:
 *  1. Maps legacy columns → promoted columns
 *  2. Upserts the promoted table (ON CONFLICT DO UPDATE)
 *  3. Sets last_synced_at = NOW()
 *  4. Inserts a state history snapshot (where applicable)
 *  5. Returns { success, error } without throwing
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BridgeResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeDate(val: string | null | undefined): string | null {
  if (!val || val.trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(val)) return null;
  // Validate by attempting parse — reject dates like 2026-04-31
  const d = new Date(val.slice(0, 10));
  if (isNaN(d.getTime())) return null;
  return val.slice(0, 10);
}

async function logBridgeError(domain: string, entityId: number | string, error: unknown): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[bridge-write][${domain}] failed`, { entityId, error: msg });
}

// ---------------------------------------------------------------------------
// Project bridge: project_info → core.projects
// ---------------------------------------------------------------------------

export async function syncProject(projectInfo: {
  id: number;
  projectName?: string | null;
  clientId?: number | null;
  phase?: string | null;
  ragStatus?: string | null;
  ragComment?: string | null;
  executionGateStatus?: string | null;
  executionGateReason?: string | null;
  archivedStatus?: string | null;
  pmUserId?: number | null;
  pdUserId?: number | null;
  currentStageCode?: string | null;
  gateStatus?: string | null;
  gateReadinessPct?: number | string | null;
  phaseUpdatedAt?: string | Date | null;
  signedStatus?: string | null;
  executionPhase?: string | null;
}): Promise<BridgeResult> {
  try {
    await db.execute(sql`
      INSERT INTO core.projects (
        id, legacy_project_info_id, project_name, client_id,
        phase, rag_status, rag_comment,
        execution_gate_status, execution_gate_reason,
        archived_status, pm_user_id, pd_user_id,
        current_stage_code, gate_status, gate_readiness_pct,
        phase_updated_at, signed_status, execution_phase,
        last_synced_at, updated_at, source_table
      ) VALUES (
        ${projectInfo.id}, ${projectInfo.id},
        ${projectInfo.projectName ?? null}, ${projectInfo.clientId ?? null},
        ${projectInfo.phase ?? null}, ${projectInfo.ragStatus ?? null}, ${projectInfo.ragComment ?? null},
        ${projectInfo.executionGateStatus ?? null}, ${projectInfo.executionGateReason ?? null},
        ${projectInfo.archivedStatus ?? null}, ${projectInfo.pmUserId ?? null}, ${projectInfo.pdUserId ?? null},
        ${projectInfo.currentStageCode ?? null}, ${projectInfo.gateStatus ?? null},
        ${projectInfo.gateReadinessPct != null ? Number(projectInfo.gateReadinessPct) : null},
        ${projectInfo.phaseUpdatedAt ? new Date(String(projectInfo.phaseUpdatedAt)) : null},
        ${projectInfo.signedStatus ?? null}, ${projectInfo.executionPhase ?? null},
        NOW(), NOW(), 'public.project_info'
      )
      ON CONFLICT (id) DO UPDATE SET
        project_name = EXCLUDED.project_name,
        client_id = EXCLUDED.client_id,
        phase = EXCLUDED.phase,
        rag_status = EXCLUDED.rag_status,
        rag_comment = EXCLUDED.rag_comment,
        execution_gate_status = EXCLUDED.execution_gate_status,
        execution_gate_reason = EXCLUDED.execution_gate_reason,
        archived_status = EXCLUDED.archived_status,
        pm_user_id = EXCLUDED.pm_user_id,
        pd_user_id = EXCLUDED.pd_user_id,
        current_stage_code = EXCLUDED.current_stage_code,
        gate_status = EXCLUDED.gate_status,
        gate_readiness_pct = EXCLUDED.gate_readiness_pct,
        phase_updated_at = EXCLUDED.phase_updated_at,
        signed_status = EXCLUDED.signed_status,
        execution_phase = EXCLUDED.execution_phase,
        last_synced_at = NOW(),
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    await logBridgeError("project", projectInfo.id, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Project state history snapshot
// ---------------------------------------------------------------------------

export async function snapshotProjectState(
  projectId: number,
  fields: Record<string, any>,
  reason: string = "bridge_write"
): Promise<BridgeResult> {
  try {
    await db.execute(sql`
      INSERT INTO core.project_state_history (
        project_id, legacy_execution_state_id,
        phase, phase_updated_at, current_stage_code, execution_phase,
        execution_gate_status, execution_gate_reason,
        gate_status, gate_readiness_pct,
        rag_status, rag_comment,
        signed_status,
        is_current, snapshot_reason, source_table, source_updated_at, snapshot_at
      )
      SELECT
        ${projectId}, pes.id,
        pes.phase, pes.phase_updated_at, pes.current_stage_code, pes.execution_phase,
        pes.execution_gate_status, pes.execution_gate_reason,
        pes.gate_status, pes.gate_readiness_pct,
        pes.rag_status, pes.rag_comment,
        pes.signed_status,
        true, ${reason}, 'public.project_execution_state', pes.updated_at, NOW()
      FROM public.project_execution_state pes
      WHERE pes.project_id = ${projectId}
        AND pes.deleted_at IS NULL
      ORDER BY pes.updated_at DESC, pes.id DESC
      LIMIT 1
    `);

    // Mark previous snapshots as not current
    await db.execute(sql`
      UPDATE core.project_state_history
      SET is_current = false
      WHERE project_id = ${projectId}
        AND is_current = true
        AND id != (
          SELECT id FROM core.project_state_history
          WHERE project_id = ${projectId}
          ORDER BY snapshot_at DESC, id DESC
          LIMIT 1
        )
    `);

    return { success: true };
  } catch (err) {
    await logBridgeError("project_state_history", projectId, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Client bridge: clients → core.clients
// ---------------------------------------------------------------------------

export async function syncClient(client: {
  id: number;
  name: string;
  clientId?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  legalEntityName?: string | null;
  tradingName?: string | null;
  clientType?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
}): Promise<BridgeResult> {
  try {
    await db.execute(sql`
      INSERT INTO core.clients (
        id, legacy_id, client_code, name, created_by, updated_by,
        legal_entity_name, trading_name, client_type,
        primary_contact_name, primary_contact_email, primary_contact_phone,
        last_synced_at, updated_at, source_table
      ) VALUES (
        ${client.id}, ${client.id}, ${client.clientId ?? null}, ${client.name},
        ${client.createdBy ?? null}, ${client.updatedBy ?? null},
        ${client.legalEntityName ?? null}, ${client.tradingName ?? null}, ${client.clientType ?? null},
        ${client.primaryContactName ?? null}, ${client.primaryContactEmail ?? null}, ${client.primaryContactPhone ?? null},
        NOW(), NOW(), 'public.clients'
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        client_code = EXCLUDED.client_code,
        updated_by = EXCLUDED.updated_by,
        legal_entity_name = EXCLUDED.legal_entity_name,
        trading_name = EXCLUDED.trading_name,
        client_type = EXCLUDED.client_type,
        primary_contact_name = EXCLUDED.primary_contact_name,
        primary_contact_email = EXCLUDED.primary_contact_email,
        primary_contact_phone = EXCLUDED.primary_contact_phone,
        last_synced_at = NOW(),
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    await logBridgeError("client", client.id, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Cost line bridge: normalized_cost_lines → finance.cost_lines
// ---------------------------------------------------------------------------

export async function syncCostLine(costLine: {
  id: number;
  projectId?: number | null;
  projectName?: string | null;
  counterpartyName?: string | null;
  description?: string | null;
  amountExVat?: string | number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  approvedDate?: string | null;
  paidDate?: string | null;
  status?: string | null;
  importRunId?: number | null;
}): Promise<BridgeResult> {
  try {
    const invoiceDateTyped = safeDate(costLine.invoiceDate);
    const approvedDateTyped = safeDate(costLine.approvedDate);
    const paidDateTyped = safeDate(costLine.paidDate);
    const amount = costLine.amountExVat != null ? Number(costLine.amountExVat) : null;

    // Resolve project_id from project_name if not provided
    let projectId = costLine.projectId;
    if (!projectId && costLine.projectName) {
      const result = await db.execute(sql`
        SELECT id FROM core.projects WHERE project_name = ${costLine.projectName} LIMIT 1
      `);
      projectId = (result.rows[0] as any)?.id ?? null;
    }

    // Derive fiscal_period_id from invoice_date_typed
    let fiscalPeriodId: number | null = null;
    if (invoiceDateTyped) {
      const fpResult = await db.execute(sql`
        SELECT id FROM finance.fiscal_periods
        WHERE ${invoiceDateTyped}::date BETWEEN start_date AND end_date
        LIMIT 1
      `);
      fiscalPeriodId = (fpResult.rows[0] as any)?.id ?? null;
    }

    await db.execute(sql`
      INSERT INTO finance.cost_lines (
        legacy_normalized_cost_line_id, project_id, project_name_snapshot,
        counterparty_name, description, amount_ex_vat,
        invoice_number, invoice_date, approved_date, paid_date,
        invoice_date_typed, approved_date_typed, paid_date_typed,
        fiscal_period_id, status, import_run_id,
        last_synced_at, source_table, created_at, updated_at
      ) VALUES (
        ${costLine.id}, ${projectId ?? null}, ${costLine.projectName ?? null},
        ${costLine.counterpartyName ?? null}, ${costLine.description ?? null}, ${amount},
        ${costLine.invoiceNumber ?? null}, ${costLine.invoiceDate ?? null},
        ${costLine.approvedDate ?? null}, ${costLine.paidDate ?? null},
        ${invoiceDateTyped ? sql`${invoiceDateTyped}::date` : null},
        ${approvedDateTyped ? sql`${approvedDateTyped}::date` : null},
        ${paidDateTyped ? sql`${paidDateTyped}::date` : null},
        ${fiscalPeriodId}, ${costLine.status ?? null}, ${costLine.importRunId ?? null},
        NOW(), 'public.normalized_cost_lines', NOW(), NOW()
      )
      ON CONFLICT (legacy_normalized_cost_line_id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        project_name_snapshot = EXCLUDED.project_name_snapshot,
        counterparty_name = EXCLUDED.counterparty_name,
        description = EXCLUDED.description,
        amount_ex_vat = EXCLUDED.amount_ex_vat,
        invoice_number = EXCLUDED.invoice_number,
        invoice_date = EXCLUDED.invoice_date,
        approved_date = EXCLUDED.approved_date,
        paid_date = EXCLUDED.paid_date,
        invoice_date_typed = EXCLUDED.invoice_date_typed,
        approved_date_typed = EXCLUDED.approved_date_typed,
        paid_date_typed = EXCLUDED.paid_date_typed,
        fiscal_period_id = EXCLUDED.fiscal_period_id,
        status = EXCLUDED.status,
        last_synced_at = NOW(),
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    await logBridgeError("cost_line", costLine.id, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Revenue line bridge: normalized_revenue_lines → finance.revenue_lines
// ---------------------------------------------------------------------------

export async function syncRevenueLine(revenueLine: {
  id: number;
  projectId?: number | null;
  projectName?: string | null;
  milestoneName?: string | null;
  amountExVat?: string | number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  expectedPaymentDate?: string | null;
  paidDate?: string | null;
  status?: string | null;
  importRunId?: number | null;
}): Promise<BridgeResult> {
  try {
    const invoiceDateTyped = safeDate(revenueLine.invoiceDate);
    const expectedDateTyped = safeDate(revenueLine.expectedPaymentDate);
    const paidDateTyped = safeDate(revenueLine.paidDate);
    const amount = revenueLine.amountExVat != null ? Number(revenueLine.amountExVat) : null;

    let projectId = revenueLine.projectId;
    if (!projectId && revenueLine.projectName) {
      const result = await db.execute(sql`
        SELECT id FROM core.projects WHERE project_name = ${revenueLine.projectName} LIMIT 1
      `);
      projectId = (result.rows[0] as any)?.id ?? null;
    }

    let fiscalPeriodId: number | null = null;
    if (invoiceDateTyped) {
      const fpResult = await db.execute(sql`
        SELECT id FROM finance.fiscal_periods
        WHERE ${invoiceDateTyped}::date BETWEEN start_date AND end_date
        LIMIT 1
      `);
      fiscalPeriodId = (fpResult.rows[0] as any)?.id ?? null;
    }

    await db.execute(sql`
      INSERT INTO finance.revenue_lines (
        legacy_normalized_revenue_line_id, project_id, project_name_snapshot,
        milestone_name, amount_ex_vat,
        invoice_number, invoice_date, expected_payment_date, paid_date,
        invoice_date_typed, expected_payment_date_typed, paid_date_typed,
        fiscal_period_id, status, import_run_id,
        last_synced_at, source_table, created_at, updated_at
      ) VALUES (
        ${revenueLine.id}, ${projectId ?? null}, ${revenueLine.projectName ?? null},
        ${revenueLine.milestoneName ?? null}, ${amount},
        ${revenueLine.invoiceNumber ?? null}, ${revenueLine.invoiceDate ?? null},
        ${revenueLine.expectedPaymentDate ?? null}, ${revenueLine.paidDate ?? null},
        ${invoiceDateTyped ? sql`${invoiceDateTyped}::date` : null},
        ${expectedDateTyped ? sql`${expectedDateTyped}::date` : null},
        ${paidDateTyped ? sql`${paidDateTyped}::date` : null},
        ${fiscalPeriodId}, ${revenueLine.status ?? null}, ${revenueLine.importRunId ?? null},
        NOW(), 'public.normalized_revenue_lines', NOW(), NOW()
      )
      ON CONFLICT (legacy_normalized_revenue_line_id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        project_name_snapshot = EXCLUDED.project_name_snapshot,
        milestone_name = EXCLUDED.milestone_name,
        amount_ex_vat = EXCLUDED.amount_ex_vat,
        invoice_number = EXCLUDED.invoice_number,
        invoice_date = EXCLUDED.invoice_date,
        expected_payment_date = EXCLUDED.expected_payment_date,
        paid_date = EXCLUDED.paid_date,
        invoice_date_typed = EXCLUDED.invoice_date_typed,
        expected_payment_date_typed = EXCLUDED.expected_payment_date_typed,
        paid_date_typed = EXCLUDED.paid_date_typed,
        fiscal_period_id = EXCLUDED.fiscal_period_id,
        status = EXCLUDED.status,
        last_synced_at = NOW(),
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    await logBridgeError("revenue_line", revenueLine.id, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Bulk helpers
// ---------------------------------------------------------------------------

export async function syncCostLines(costLines: Parameters<typeof syncCostLine>[0][]): Promise<BridgeResult[]> {
  return Promise.all(costLines.map(syncCostLine));
}

export async function syncRevenueLines(revenueLines: Parameters<typeof syncRevenueLine>[0][]): Promise<BridgeResult[]> {
  return Promise.all(revenueLines.map(syncRevenueLine));
}
