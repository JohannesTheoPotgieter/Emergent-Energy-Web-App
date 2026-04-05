/**
 * Smart Import → Finance Records Bridge — Post-Migration
 *
 * After smart import writes cost/revenue lines (via INSTEAD OF triggers to
 * finance.cost_lines/revenue_lines), this function scans for lines that
 * represent POs or invoices and ensures corresponding finance_records exist.
 *
 * Only creates new records if they don't already exist (change detection).
 * Called after each smart import commit.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Syncs cost lines with PO numbers to finance.finance_records.
 * Only creates records for lines that have a PO number and don't already
 * have a corresponding finance_record.
 */
export async function syncImportedLinesToFinanceRecords(projectInstanceId: number | null): Promise<{ created: number; skipped: number }> {
  if (!projectInstanceId) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;

  try {
    // Find cost lines with PO numbers that don't have finance_records yet
    const poLines = await db.execute(sql`
      SELECT
        cl.id AS cost_line_id,
        cl.project_id,
        cl.expense_po_number,
        cl.supplier_name,
        cl.expense_actual_total,
        cl.expense_invoice_number,
        cl.expense_invoiced_date,
        cl.expense_payment_date
      FROM finance.cost_lines cl
      WHERE cl.project_id = ${projectInstanceId}
        AND cl.expense_po_number IS NOT NULL
        AND cl.expense_po_number != ''
        AND NOT EXISTS (
          SELECT 1 FROM finance.finance_records fr
          WHERE fr.legacy_entity_table = 'cost_line_po'
            AND fr.legacy_entity_id = cl.id
        )
      LIMIT 500
    `);

    for (const line of poLines.rows as any[]) {
      try {
        // Resolve party from supplier name
        const partyResult = await db.execute(sql`
          SELECT id FROM core.parties
          WHERE name_canonical ILIKE ${line.supplier_name || ''}
          LIMIT 1
        `);
        const partyId = (partyResult.rows[0] as { id: number } | undefined)?.id ?? null;

        await db.execute(sql`
          INSERT INTO finance.finance_records (
            legacy_entity_id, legacy_entity_table,
            project_instance_id, party_id,
            financial_type, direction, title,
            amount_ex_vat, status,
            record_data, import_source
          ) VALUES (
            ${line.cost_line_id}, 'cost_line_po',
            ${projectInstanceId}, ${partyId},
            'purchase_order', 'outflow',
            ${'PO ' + (line.expense_po_number || '')},
            ${parseFloat(line.expense_actual_total) || 0}::numeric,
            ${line.expense_payment_date ? 'paid' : line.expense_invoiced_date ? 'approved' : 'draft'},
            ${JSON.stringify({
              poNumber: line.expense_po_number,
              invoiceNumber: line.expense_invoice_number,
              supplierName: line.supplier_name,
            })}::jsonb,
            'smart_import'
          )
          ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE SET
            amount_ex_vat = EXCLUDED.amount_ex_vat,
            status = EXCLUDED.status,
            record_data = EXCLUDED.record_data,
            updated_at = NOW()
        `);
        created++;
      } catch {
        skipped++;
      }
    }
  } catch (err) {
    console.error("[SmartImport→FinanceRecords] Sync failed:", err);
  }

  return { created, skipped };
}
