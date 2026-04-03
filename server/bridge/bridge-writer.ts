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

export async function syncProject(p: Record<string, any> & { id: number }): Promise<BridgeResult> {
  try {
    // Full-spine sync: pass through all columns the app writes.
    // Uses a generic UPDATE SET approach to avoid maintaining a huge INSERT.
    await db.execute(sql`
      UPDATE core.projects SET
        project_name = COALESCE(${p.projectName ?? null}, project_name),
        client_id = ${p.clientId ?? null},
        phase = ${p.phase ?? null},
        rag_status = ${p.ragStatus ?? null},
        rag_comment = ${p.ragComment ?? null},
        execution_gate_status = ${p.executionGateStatus ?? null},
        execution_gate_reason = ${p.executionGateReason ?? null},
        archived_status = ${p.archivedStatus ?? null},
        pm_user_id = ${p.pmUserId ?? null},
        pd_user_id = ${p.pdUserId ?? null},
        current_stage_code = ${p.currentStageCode ?? null},
        gate_status = ${p.gateStatus ?? null},
        signed_status = ${p.signedStatus ?? null},
        execution_phase = ${p.executionPhase ?? null},
        size_kwp = COALESCE(${p.sizeKwp ?? null}, size_kwp),
        contract_value = COALESCE(${p.contractValue ?? null}, contract_value),
        is_active = COALESCE(${p.isActive ?? null}, is_active),
        execution_enabled = COALESCE(${p.executionEnabled ?? null}, execution_enabled),
        signed_date = COALESCE(${p.signedDate ?? null}, signed_date),
        signed_document_link = COALESCE(${p.signedDocumentLink ?? null}, signed_document_link),
        excel_tracker_link = COALESCE(${p.excelTrackerLink ?? null}, excel_tracker_link),
        cp_signed = COALESCE(${p.cpSigned ?? null}, cp_signed),
        cp_signed_date = COALESCE(${p.cpSignedDate ?? null}, cp_signed_date),
        cp_signed_by_user_id = COALESCE(${p.cpSignedByUserId ?? null}, cp_signed_by_user_id),
        cp_evidence_type = COALESCE(${p.cpEvidenceType ?? null}, cp_evidence_type),
        cp_evidence_ref = COALESCE(${p.cpEvidenceRef ?? null}, cp_evidence_ref),
        pm_task_pack_created = COALESCE(${p.pmTaskPackCreated ?? null}, pm_task_pack_created),
        eng_post_cp_task_pack_created = COALESCE(${p.engPostCpTaskPackCreated ?? null}, eng_post_cp_task_pack_created),
        site_id = COALESCE(${p.siteId ?? null}, site_id),
        opportunity_id = COALESCE(${p.opportunityId ?? null}, opportunity_id),
        delivery_model = COALESCE(${p.deliveryModel ?? null}, delivery_model),
        last_synced_at = NOW(),
        updated_at = NOW()
      WHERE id = ${p.id}
    `);
    return { success: true };
  } catch (err) {
    await logBridgeError("project", p.id, err);
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

export async function syncCostLine(costLine: Record<string, any> & { id: number }): Promise<BridgeResult> {
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
        cost_category = COALESCE(${costLine.costCategory ?? null}, finance.cost_lines.cost_category),
        po_number = COALESCE(${costLine.poNumber ?? null}, finance.cost_lines.po_number),
        cost_line_status = COALESCE(${costLine.costLineStatus ?? null}, finance.cost_lines.cost_line_status),
        invoice_date_font_color = COALESCE(${costLine.invoiceDateFontColor ?? null}, finance.cost_lines.invoice_date_font_color),
        invoice_date_confirmed = COALESCE(${costLine.invoiceDateConfirmed ?? null}, finance.cost_lines.invoice_date_confirmed),
        paid_date_font_color = COALESCE(${costLine.paidDateFontColor ?? null}, finance.cost_lines.paid_date_font_color),
        paid_date_confirmed = COALESCE(${costLine.paidDateConfirmed ?? null}, finance.cost_lines.paid_date_confirmed),
        no_revenue_linked = COALESCE(${costLine.noRevenueLinked ?? null}, finance.cost_lines.no_revenue_linked),
        cos_status_override = COALESCE(${costLine.cosStatusOverride ?? null}, finance.cost_lines.cos_status_override),
        cos_status_override_by = COALESCE(${costLine.cosStatusOverrideBy ?? null}, finance.cost_lines.cos_status_override_by),
        cos_status_override_reason = COALESCE(${costLine.cosStatusOverrideReason ?? null}, finance.cost_lines.cos_status_override_reason),
        sub_project_name = COALESCE(${costLine.subProjectName ?? null}, finance.cost_lines.sub_project_name),
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

export async function syncRevenueLine(revenueLine: Record<string, any> & { id: number }): Promise<BridgeResult> {
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
        description = COALESCE(${revenueLine.description ?? null}, finance.revenue_lines.description),
        invoice_date_font_color = COALESCE(${revenueLine.invoiceDateFontColor ?? null}, finance.revenue_lines.invoice_date_font_color),
        invoice_date_confirmed = COALESCE(${revenueLine.invoiceDateConfirmed ?? null}, finance.revenue_lines.invoice_date_confirmed),
        paid_date_font_color = COALESCE(${revenueLine.paidDateFontColor ?? null}, finance.revenue_lines.paid_date_font_color),
        paid_date_confirmed = COALESCE(${revenueLine.paidDateConfirmed ?? null}, finance.revenue_lines.paid_date_confirmed),
        in_bank_date = COALESCE(${revenueLine.inBankDate ?? null}, finance.revenue_lines.in_bank_date),
        sub_project_name = COALESCE(${revenueLine.subProjectName ?? null}, finance.revenue_lines.sub_project_name),
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
