/**
 * Bridge Writer — Phase 2 dual-write module
 *
 * Propagates legacy table writes to promoted schema tables.
 * Bridge writes retry once on transient failures and log persistent
 * failures to internal.bridge_sync_failures for reconciliation pickup.
 * Staleness is detected by reconciliation via the last_synced_at column.
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
  retried?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeDate(val: string | null | undefined): string | null {
  if (!val || val.trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(val)) return null;
  const d = new Date(val.slice(0, 10));
  if (isNaN(d.getTime())) return null;
  return val.slice(0, 10);
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /connection|ECONNREFUSED|timeout|deadlock|could not serialize/i.test(msg);
}

async function logBridgeError(domain: string, entityId: number | string, error: unknown): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[bridge-write][${domain}] failed`, { entityId, error: msg });

  // Persist failure for reconciliation pickup (best-effort, never throw)
  try {
    await db.execute(sql`
      INSERT INTO internal.bridge_sync_failures (
        domain, entity_id, error_message, created_at
      ) VALUES (
        ${domain}, ${String(entityId)}, ${msg.slice(0, 1000)}, NOW()
      )
      ON CONFLICT DO NOTHING
    `);
  } catch {
    // Table may not exist yet — swallow silently
  }
}

/**
 * Retry wrapper: attempts the bridge operation, retries once after 200ms
 * on transient errors (connection, timeout, deadlock).
 */
async function withRetry(
  domain: string,
  entityId: number | string,
  operation: () => Promise<BridgeResult>,
): Promise<BridgeResult> {
  const first = await operation();
  if (first.success) return first;

  // Only retry transient errors
  if (!first.error || !isTransientError(new Error(first.error))) {
    await logBridgeError(domain, entityId, new Error(first.error));
    return first;
  }

  // Wait 200ms then retry once
  await new Promise(r => setTimeout(r, 200));
  const second = await operation();
  if (!second.success) {
    await logBridgeError(domain, entityId, new Error(second.error));
  }
  return { ...second, retried: true };
}

// ---------------------------------------------------------------------------
// Project bridge: project_info → core.projects
// ---------------------------------------------------------------------------

export async function syncProject(p: Record<string, any> & { id: number }): Promise<BridgeResult> {
  return withRetry("project", p.id, async () => {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
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
  return withRetry("client", client.id, async () => {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// Cost line bridge: normalized_cost_lines → finance.cost_lines
// ---------------------------------------------------------------------------

export async function syncCostLine(costLine: Record<string, any> & { id: number }): Promise<BridgeResult> {
  return withRetry("cost_line", costLine.id, async () => {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// Revenue line bridge: normalized_revenue_lines → finance.revenue_lines
// ---------------------------------------------------------------------------

export async function syncRevenueLine(revenueLine: Record<string, any> & { id: number }): Promise<BridgeResult> {
  return withRetry("revenue_line", revenueLine.id, async () => {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// Project INSERT bridge: project_info INSERT → core.projects INSERT
// ---------------------------------------------------------------------------

export async function syncProjectInsert(p: Record<string, any> & { id: number }): Promise<BridgeResult> {
  return withRetry("project_insert", p.id, async () => {
  try {
    await db.execute(sql`
      INSERT INTO core.projects (
        id, project_name, client_id, phase,
        rag_status, rag_comment,
        execution_gate_status, execution_gate_reason,
        archived_status, pm_user_id, pd_user_id,
        current_stage_code, gate_status,
        signed_status, execution_phase,
        size_kwp, contract_value,
        is_active, execution_enabled,
        signed_date, signed_document_link, excel_tracker_link,
        cp_signed, cp_signed_date, cp_signed_by_user_id,
        cp_evidence_type, cp_evidence_ref,
        pm_task_pack_created, eng_post_cp_task_pack_created,
        site_id, opportunity_id, delivery_model,
        last_synced_at, created_at, updated_at
      ) VALUES (
        ${p.id}, ${p.projectName ?? null}, ${p.clientId ?? null}, ${p.phase ?? null},
        ${p.ragStatus ?? null}, ${p.ragComment ?? null},
        ${p.executionGateStatus ?? null}, ${p.executionGateReason ?? null},
        ${p.archivedStatus ?? null}, ${p.pmUserId ?? null}, ${p.pdUserId ?? null},
        ${p.currentStageCode ?? null}, ${p.gateStatus ?? null},
        ${p.signedStatus ?? null}, ${p.executionPhase ?? null},
        ${p.sizeKwp ?? null}, ${p.contractValue ?? null},
        ${p.isActive ?? true}, ${p.executionEnabled ?? false},
        ${p.signedDate ?? null}, ${p.signedDocumentLink ?? null}, ${p.excelTrackerLink ?? null},
        ${p.cpSigned ?? null}, ${p.cpSignedDate ?? null}, ${p.cpSignedByUserId ?? null},
        ${p.cpEvidenceType ?? null}, ${p.cpEvidenceRef ?? null},
        ${p.pmTaskPackCreated ?? null}, ${p.engPostCpTaskPackCreated ?? null},
        ${p.siteId ?? null}, ${p.opportunityId ?? null}, ${p.deliveryModel ?? null},
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        project_name = EXCLUDED.project_name,
        last_synced_at = NOW(),
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// User bridge: users → core.user_accounts
// ---------------------------------------------------------------------------

export async function syncUser(user: {
  id: number;
  username: string;
  name: string;
  email: string;
  role?: string | null;
  department?: string | null;
}): Promise<BridgeResult> {
  return withRetry("user", user.id, async () => {
  try {
    await db.execute(sql`
      INSERT INTO core.user_accounts (
        id, legacy_id, username, display_name, email,
        role_code, department,
        last_synced_at, source_table, created_at, updated_at
      ) VALUES (
        ${user.id}, ${user.id}, ${user.username}, ${user.name}, ${user.email},
        ${user.role ?? null}, ${user.department ?? null},
        NOW(), 'public.users', NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        role_code = EXCLUDED.role_code,
        department = EXCLUDED.department,
        last_synced_at = NOW(),
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// Soft-close bridge: mark promoted finance lines as closed
// ---------------------------------------------------------------------------

export async function softClosePromotedCostLines(
  projectId: number | null,
  projectName: string | null,
): Promise<BridgeResult> {
  return withRetry("soft_close_cost_lines", projectId ?? 0, async () => {
  try {
    const condition = projectId
      ? sql`project_id = ${projectId}`
      : sql`project_name_snapshot = ${projectName}`;
    await db.execute(sql`
      UPDATE finance.cost_lines
      SET effective_to = NOW(), updated_at = NOW()
      WHERE ${condition} AND effective_to IS NULL
    `);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

export async function softClosePromotedRevenueLines(
  projectId: number | null,
  projectName: string | null,
): Promise<BridgeResult> {
  return withRetry("soft_close_revenue_lines", projectId ?? 0, async () => {
  try {
    const condition = projectId
      ? sql`project_id = ${projectId}`
      : sql`project_name_snapshot = ${projectName}`;
    await db.execute(sql`
      UPDATE finance.revenue_lines
      SET effective_to = NOW(), updated_at = NOW()
      WHERE ${condition} AND effective_to IS NULL
    `);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// Hard-delete cascade: remove promoted finance lines when legacy rows deleted
// ---------------------------------------------------------------------------

export async function cascadeDeletePromotedFinanceLines(
  projectId: number | null,
  projectName: string | null,
): Promise<BridgeResult> {
  return withRetry("cascade_delete_finance", projectId ?? 0, async () => {
  try {
    const costCondition = projectId
      ? sql`project_id = ${projectId}`
      : sql`project_name_snapshot = ${projectName}`;
    const revCondition = costCondition;

    await db.execute(sql`DELETE FROM finance.cost_lines WHERE ${costCondition}`);
    await db.execute(sql`DELETE FROM finance.revenue_lines WHERE ${revCondition}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
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

// ---------------------------------------------------------------------------
// Change Request / Variation Order bridge → finance.finance_records
// ---------------------------------------------------------------------------

export async function syncChangeRequest(cr: {
  id: number;
  projectId: number;
  title: string;
  changeType?: string | null;
  status?: string | null;
  costImpact?: string | number | null;
  revenueImpact?: string | number | null;
  cosImpact?: string | number | null;
  marginImpact?: string | number | null;
  cause?: string | null;
  clientLinked?: boolean | null;
  impactSummary?: string | null;
  evidenceLink?: string | null;
}): Promise<BridgeResult> {
  return withRetry("change_request", cr.id, async () => {
  try {
    // Resolve project_instance_id from legacy project_id
    const piResult = await db.execute(sql`
      SELECT id FROM core.project_instances
      WHERE legacy_project_id = ${cr.projectId}
      LIMIT 1
    `);
    const projectInstanceId = (piResult.rows[0] as any)?.id ?? null;

    const costAmount = cr.costImpact != null ? Number(cr.costImpact) : null;
    const direction = costAmount != null && costAmount < 0 ? 'inflow' : 'outflow';

    await db.execute(sql`
      INSERT INTO finance.finance_records (
        legacy_entity_id, legacy_entity_table,
        project_instance_id,
        financial_type, direction, title,
        amount_ex_vat, status,
        record_data, import_source,
        created_at, updated_at
      ) VALUES (
        ${cr.id}, 'public.change_requests',
        ${projectInstanceId},
        'variation_order', ${direction}, ${cr.title},
        ${costAmount}, ${cr.status ?? 'draft'},
        ${sql`${JSON.stringify({
          change_type: cr.changeType,
          cause: cr.cause,
          client_linked: cr.clientLinked,
          revenue_impact: cr.revenueImpact,
          cos_impact: cr.cosImpact,
          margin_impact: cr.marginImpact,
          impact_summary: cr.impactSummary,
          evidence_link: cr.evidenceLink,
        })}::jsonb`},
        'bridge_writer',
        NOW(), NOW()
      )
      ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE SET
        title = EXCLUDED.title,
        amount_ex_vat = EXCLUDED.amount_ex_vat,
        status = EXCLUDED.status,
        direction = EXCLUDED.direction,
        record_data = EXCLUDED.record_data,
        updated_at = NOW()
    `);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}

// ---------------------------------------------------------------------------
// Project execution state bridge → core.project_state_history
// ---------------------------------------------------------------------------

export async function syncProjectExecutionState(
  projectId: number,
  fields: Record<string, any>,
): Promise<BridgeResult> {
  return withRetry("project_execution_state", projectId, async () => {
  try {
    await db.execute(sql`
      UPDATE core.projects SET
        phase = COALESCE(${fields.phase ?? null}, phase),
        rag_status = COALESCE(${fields.ragStatus ?? null}, rag_status),
        rag_comment = COALESCE(${fields.ragComment ?? null}, rag_comment),
        execution_gate_status = COALESCE(${fields.executionGateStatus ?? null}, execution_gate_status),
        execution_gate_reason = COALESCE(${fields.executionGateReason ?? null}, execution_gate_reason),
        execution_phase = COALESCE(${fields.executionPhase ?? null}, execution_phase),
        signed_status = COALESCE(${fields.signedStatus ?? null}, signed_status),
        signed_date = COALESCE(${fields.signedDate ?? null}, signed_date),
        is_active = COALESCE(${fields.isActive ?? null}, is_active),
        execution_enabled = COALESCE(${fields.executionEnabled ?? null}, execution_enabled),
        archived_status = COALESCE(${fields.archivedStatus ?? null}, archived_status),
        last_synced_at = NOW(),
        updated_at = NOW()
      WHERE id = ${projectId}
    `);

    // Also snapshot to state history for audit
    await snapshotProjectState(projectId, fields, "execution_state_bridge");

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  });
}
