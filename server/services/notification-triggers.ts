/**
 * C5: Notification trigger expansion
 *
 * Scheduled trigger checks for events that need notifications.
 * Uses existing notification-service.ts for delivery with throttling.
 *
 * Triggers:
 *   - snag_overdue: snag past due date → notify assigned user
 *   - approval_overdue: approval pending > 3 days → notify approver
 *   - inspection_due: inspection scheduled within 2 days → notify inspector
 *   - procurement_delivery_late: delivery past expected date → notify PM
 *   - handover_stalled: handover pack unchanged for >7 days → notify PM
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { createNotification } from "./notification-service";
import { notifyHighUnverifiedDrift } from "./notification-triggers-excel-vs-app";

export interface NotificationTriggerResult {
  trigger: string;
  count: number;
  notified: number;
  errors: string[];
}

/**
 * Check all notification triggers and create notifications.
 * Call this on a schedule (e.g., every hour) or after relevant data changes.
 */
export async function checkAllNotificationTriggers(): Promise<NotificationTriggerResult[]> {
  const results: NotificationTriggerResult[] = [];

  const triggers = [
    { name: "snag_overdue", fn: notifyOverdueSnags },
    { name: "approval_overdue", fn: notifyOverdueApprovals },
    { name: "inspection_due", fn: notifyUpcomingInspections },
    { name: "procurement_delivery_late", fn: notifyLateProcurementDeliveries },
    { name: "handover_stalled", fn: notifyStalledHandovers },
    // Excel-vs-App daily digest. Hourly trigger but the function's
    // 22h-throttle ensures one notification per recipient per day.
    { name: "excel_vs_app_daily_digest", fn: notifyHighUnverifiedDrift },
  ];

  for (const trigger of triggers) {
    try {
      const { count, notified } = await trigger.fn();
      results.push({ trigger: trigger.name, count, notified, errors: [] });
    } catch (err) {
      results.push({
        trigger: trigger.name,
        count: 0,
        notified: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  return results;
}

async function notifyOverdueSnags(): Promise<{ count: number; notified: number }> {
  const result = await db.execute(sql`
    SELECT s.id, s.title, s.assigned_to_user_id, s.project_id
    FROM snags s
    WHERE s.status IN ('open', 'in_progress')
      AND s.due_date < CURRENT_DATE
      AND s.deleted_at IS NULL
      AND s.assigned_to_user_id IS NOT NULL
    LIMIT 50
  `);
  const rows = (result as any).rows || [];
  let notified = 0;
  for (const row of rows) {
    try {
      const n = await createNotification({
        recipientUserId: row.assigned_to_user_id,
        eventType: "snag_overdue",
        title: `Overdue snag: ${row.title}`,
        body: "This snag is past its due date and needs attention.",
        projectId: row.project_id,
        relatedEntityType: "snag",
        relatedEntityId: row.id,
      });
      if (n) notified++;
    } catch { /* throttled or failed — skip */ }
  }
  return { count: rows.length, notified };
}

async function notifyOverdueApprovals(): Promise<{ count: number; notified: number }> {
  const result = await db.execute(sql`
    SELECT a.id, a.title, a.assigned_approver, a.project_id
    FROM approvals a
    WHERE a.status = 'pending'
      AND a.requested_at < NOW() - INTERVAL '3 days'
      AND a.assigned_approver IS NOT NULL
    LIMIT 50
  `);
  const rows = (result as any).rows || [];
  let notified = 0;
  for (const row of rows) {
    try {
      const n = await createNotification({
        recipientUserId: row.assigned_approver,
        eventType: "approval_overdue",
        title: `Overdue approval: ${row.title}`,
        body: "This approval has been pending for more than 3 days.",
        projectId: row.project_id,
        relatedEntityType: "approval",
        relatedEntityId: row.id,
      });
      if (n) notified++;
    } catch { /* throttled */ }
  }
  return { count: rows.length, notified };
}

async function notifyUpcomingInspections(): Promise<{ count: number; notified: number }> {
  const result = await db.execute(sql`
    SELECT si.id, si.inspection_type, si.inspector_user_id, si.project_id
    FROM site_inspections si
    WHERE si.status = 'scheduled'
      AND si.inspection_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '2 days'
      AND si.deleted_at IS NULL
      AND si.inspector_user_id IS NOT NULL
    LIMIT 50
  `);
  const rows = (result as any).rows || [];
  let notified = 0;
  for (const row of rows) {
    try {
      const n = await createNotification({
        recipientUserId: row.inspector_user_id,
        eventType: "inspection_due",
        title: `Inspection due: ${row.inspection_type}`,
        body: "A site inspection is scheduled within the next 2 days.",
        projectId: row.project_id,
        relatedEntityType: "site_inspection",
        relatedEntityId: row.id,
      });
      if (n) notified++;
    } catch { /* throttled */ }
  }
  return { count: rows.length, notified };
}

async function notifyLateProcurementDeliveries(): Promise<{ count: number; notified: number }> {
  const result = await db.execute(sql`
    SELECT pi.id, pi.title, pi.project_id, p.pm_user_id
    FROM procurement_items pi
    JOIN project_info p ON p.id = pi.project_id
    WHERE pi.delivery_status IN ('ordered', 'shipped')
      AND pi.delivery_expected_date < CURRENT_DATE
      AND pi.delivery_actual_date IS NULL
      AND p.pm_user_id IS NOT NULL
    LIMIT 50
  `);
  const rows = (result as any).rows || [];
  let notified = 0;
  for (const row of rows) {
    try {
      const n = await createNotification({
        recipientUserId: row.pm_user_id,
        eventType: "procurement_delivery_late",
        title: `Late delivery: ${row.title}`,
        body: "This procurement item has passed its expected delivery date.",
        projectId: row.project_id,
        relatedEntityType: "procurement_item",
        relatedEntityId: row.id,
      });
      if (n) notified++;
    } catch { /* throttled */ }
  }
  return { count: rows.length, notified };
}

async function notifyStalledHandovers(): Promise<{ count: number; notified: number }> {
  const result = await db.execute(sql`
    SELECT hp.id, hp.pack_type, hp.project_id, p.pm_user_id
    FROM handover_packs hp
    JOIN project_info p ON p.id = hp.project_id
    WHERE hp.status IN ('draft', 'in_progress')
      AND hp.updated_at < NOW() - INTERVAL '7 days'
      AND hp.deleted_at IS NULL
      AND p.pm_user_id IS NOT NULL
    LIMIT 50
  `);
  const rows = (result as any).rows || [];
  let notified = 0;
  for (const row of rows) {
    try {
      const n = await createNotification({
        recipientUserId: row.pm_user_id,
        eventType: "handover_stalled",
        title: `Stalled handover: ${(row.pack_type || "").replace(/_/g, " ")}`,
        body: "This handover pack has not been updated in over 7 days.",
        projectId: row.project_id,
        relatedEntityType: "handover_pack",
        relatedEntityId: row.id,
      });
      if (n) notified++;
    } catch { /* throttled */ }
  }
  return { count: rows.length, notified };
}
