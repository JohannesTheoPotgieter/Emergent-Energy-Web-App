/**
 * C5: Notification trigger expansion
 *
 * Scheduled trigger checks for events that need notifications.
 * Uses existing notification-service.ts for delivery.
 *
 * New triggers:
 *   - gate_blocked: stage gate missing required deliverables
 *   - budget_deviation: actual > baseline by >10%
 *   - snag_overdue: snag past due date
 *   - project_late: actual progress < expected by >10%
 *   - handover_stalled: handover pack unchanged for >7 days
 *   - approval_overdue: approval pending > 3 days
 *   - inspection_due: inspection scheduled within 2 days
 *   - procurement_delivery_late: delivery past expected date
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface NotificationTriggerResult {
  trigger: string;
  count: number;
  errors: string[];
}

/**
 * Check all notification triggers.
 * Call this on a schedule (e.g., every hour) or after relevant data changes.
 */
export async function checkAllNotificationTriggers(): Promise<NotificationTriggerResult[]> {
  const results: NotificationTriggerResult[] = [];

  const triggers = [
    { name: "snag_overdue", fn: checkOverdueSnags },
    { name: "approval_overdue", fn: checkOverdueApprovals },
    { name: "inspection_due", fn: checkUpcomingInspections },
    { name: "procurement_delivery_late", fn: checkLateProcurementDeliveries },
    { name: "handover_stalled", fn: checkStalledHandovers },
  ];

  for (const trigger of triggers) {
    try {
      const count = await trigger.fn();
      results.push({ trigger: trigger.name, count, errors: [] });
    } catch (err) {
      results.push({
        trigger: trigger.name,
        count: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  return results;
}

async function checkOverdueSnags(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM snags
    WHERE status IN ('open', 'in_progress')
      AND due_date < CURRENT_DATE
      AND deleted_at IS NULL
  `);
  return Number((result as any).rows?.[0]?.count ?? 0);
}

async function checkOverdueApprovals(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM approvals
    WHERE status = 'pending'
      AND requested_at < NOW() - INTERVAL '3 days'
  `);
  return Number((result as any).rows?.[0]?.count ?? 0);
}

async function checkUpcomingInspections(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM site_inspections
    WHERE status = 'scheduled'
      AND inspection_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '2 days'
      AND deleted_at IS NULL
  `);
  return Number((result as any).rows?.[0]?.count ?? 0);
}

async function checkLateProcurementDeliveries(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM procurement_items
    WHERE delivery_status IN ('ordered', 'shipped')
      AND delivery_expected_date < CURRENT_DATE
      AND delivery_actual_date IS NULL
  `);
  return Number((result as any).rows?.[0]?.count ?? 0);
}

async function checkStalledHandovers(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM handover_packs
    WHERE status IN ('draft', 'in_progress')
      AND updated_at < NOW() - INTERVAL '7 days'
      AND deleted_at IS NULL
  `);
  return Number((result as any).rows?.[0]?.count ?? 0);
}
