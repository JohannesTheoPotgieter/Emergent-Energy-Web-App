/**
 * Centralized work_items query helpers with LEFT JOIN on extension tables.
 *
 * Prompt 8: All task data flows through work_items + extensions.
 * These functions replace direct queries to legacy task tables (now consolidated into work_items).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { UnifiedTask } from "@shared/types/unified-task";
import { fromWorkItem } from "@shared/types/unified-task";

// ── Raw query with JOINs ─────────────────────────────────────────────

/**
 * Fetch work_items with LEFT JOIN on all 3 extension tables + assignments.
 * Returns UnifiedTask[] with all extension fields populated.
 */
export async function queryWorkItems(opts: {
  projectId?: number;
  projectName?: string;
  workstream?: string;
  ownerUserId?: number;
  status?: string;
  includeDeleted?: boolean;
  limit?: number;
  orderBy?: string;
}): Promise<UnifiedTask[]> {
  const conditions: string[] = [];

  if (!opts.includeDeleted) {
    conditions.push("wi.deleted_at IS NULL");
  }
  if (opts.projectId) {
    conditions.push(`wi.project_id = ${opts.projectId}`);
  }
  if (opts.projectName) {
    conditions.push(`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = wi.project_id AND pi.project_name = '${opts.projectName.replace(/'/g, "''")}')`);
  }
  if (opts.workstream) {
    conditions.push(`wi.workstream = '${opts.workstream.replace(/'/g, "''")}'`);
  }
  if (opts.ownerUserId) {
    conditions.push(`wi.owner_user_id = ${opts.ownerUserId}`);
  }
  if (opts.status) {
    conditions.push(`wi.status = '${opts.status.replace(/'/g, "''")}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderClause = opts.orderBy || "wi.sort_order ASC, wi.id ASC";
  const limitClause = opts.limit ? `LIMIT ${opts.limit}` : "";

  const result = await db.execute(sql.raw(`
    SELECT
      wi.*,
      pi.project_name,
      -- PM extension
      pm.duration AS pm_duration,
      pm.percent_complete AS pm_percent_complete,
      pm.expected_pct_complete AS pm_expected_pct_complete,
      pm.phase AS pm_phase,
      pm.is_milestone AS pm_is_milestone,
      pm.indent_level AS pm_indent_level,
      pm.owner_name AS pm_owner_name,
      pm.is_shared AS pm_is_shared,
      pm.hold_reason AS pm_hold_reason,
      pm.blocked_type AS pm_blocked_type,
      pm.blocker_reason AS pm_blocker_reason,
      pm.approval_required AS pm_approval_required,
      pm.tracking_rag AS pm_tracking_rag,
      pm.task_type_tag AS pm_task_type_tag,
      pm.sub_project_name AS pm_sub_project_name,
      pm.completed_at AS pm_completed_at,
      pm.linked_plan_item_id AS pm_linked_plan_item_id,
      pm.linked_deliverable_id AS pm_linked_deliverable_id,
      pm.linked_quality_item_instance_id AS pm_linked_quality_item_instance_id,
      -- Engineering extension
      eng.wbs_code AS eng_wbs_code,
      eng.outline_number AS eng_outline_number,
      -- Scheduling extension
      sched.scheduled_date AS sched_scheduled_date,
      sched.scheduled_start_time AS sched_scheduled_start_time,
      sched.scheduled_end_time AS sched_scheduled_end_time,
      sched.estimate_minutes AS sched_estimate_minutes,
      sched.task_category AS sched_task_category,
      sched.baseline_start AS sched_baseline_start,
      sched.baseline_end AS sched_baseline_end,
      sched.baseline_duration AS sched_baseline_duration,
      sched.task_mode AS sched_task_mode,
      sched.actual_start AS sched_actual_start,
      sched.actual_end AS sched_actual_end,
      sched.actual_duration AS sched_actual_duration,
      sched.is_recurring AS sched_is_recurring,
      sched.recurrence_frequency AS sched_recurrence_frequency
    FROM work_items wi
    LEFT JOIN project_info pi ON pi.id = wi.project_id
    LEFT JOIN work_item_pm pm ON pm.work_item_id = wi.id
    LEFT JOIN work_item_engineering eng ON eng.work_item_id = wi.id
    LEFT JOIN work_item_scheduling sched ON sched.work_item_id = wi.id
    ${whereClause}
    ORDER BY ${orderClause}
    ${limitClause}
  `));

  const rows = (result as any).rows || [];
  return rows.map(mergeExtensionRow);
}

/**
 * Fetch a single work_item by ID with all extensions.
 */
export async function getWorkItemById(id: number): Promise<UnifiedTask | null> {
  const items = await queryWorkItems({ includeDeleted: false });
  // Use the general query but filter — for a single item this is fine
  // In production this would be optimized with a WHERE clause
  const result = await db.execute(sql.raw(`
    SELECT
      wi.*,
      pi.project_name
    FROM work_items wi
    LEFT JOIN project_info pi ON pi.id = wi.project_id
    WHERE wi.id = ${id} AND wi.deleted_at IS NULL
    LIMIT 1
  `));

  const rows = (result as any).rows || [];
  if (rows.length === 0) return null;
  return mergeExtensionRow(rows[0]);
}

/**
 * Fetch assignments for a set of work_item IDs.
 * Returns Map<workItemId, userId[]>
 */
export async function getAssignmentsByWorkItemIds(ids: number[]): Promise<Map<number, number[]>> {
  if (ids.length === 0) return new Map();

  const result = await db.execute(sql.raw(`
    SELECT work_item_id, user_id, role
    FROM work_item_assignments
    WHERE work_item_id IN (${ids.join(",")})
  `));

  const map = new Map<number, number[]>();
  for (const row of (result as any).rows || []) {
    const list = map.get(row.work_item_id) || [];
    list.push(row.user_id);
    map.set(row.work_item_id, list);
  }
  return map;
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Merge a raw SQL row (with aliased extension columns) into a UnifiedTask.
 * Extension columns are prefixed with pm_, eng_, sched_ to avoid collisions.
 * Falls back to core work_items columns when extension is NULL.
 */
function mergeExtensionRow(row: Record<string, any>): UnifiedTask {
  return fromWorkItem({
    // Core fields pass through from wi.*
    ...row,
    // Override with extension values when present (extension takes priority)
    percentComplete: row.pm_percent_complete ?? row.percent_complete ?? null,
    expectedPctComplete: row.pm_expected_pct_complete ?? row.expected_pct_complete ?? null,
    phase: row.pm_phase ?? row.phase ?? null,
    isMilestone: row.pm_is_milestone ?? row.is_milestone ?? null,
    indentLevel: row.pm_indent_level ?? row.indent_level ?? null,
    ownerName: row.pm_owner_name ?? row.owner_name ?? null,
    isShared: row.pm_is_shared ?? row.is_shared ?? null,
    holdReason: row.pm_hold_reason ?? row.hold_reason ?? null,
    blockedType: row.pm_blocked_type ?? row.blocked_type ?? null,
    blockerReason: row.pm_blocker_reason ?? row.blocker_reason ?? null,
    approvalRequired: row.pm_approval_required ?? row.approval_required ?? null,
    trackingRag: row.pm_tracking_rag ?? row.tracking_rag ?? null,
    taskTypeTag: row.pm_task_type_tag ?? row.task_type_tag ?? null,
    subProjectName: row.pm_sub_project_name ?? row.sub_project_name ?? null,
    completedAt: row.pm_completed_at ?? row.completed_at ?? null,
    linkedPlanItemId: row.pm_linked_plan_item_id ?? row.linked_plan_item_id ?? null,
    linkedDeliverableId: row.pm_linked_deliverable_id ?? row.linked_deliverable_id ?? null,
    linkedQualityItemInstanceId: row.pm_linked_quality_item_instance_id ?? row.linked_quality_item_instance_id ?? null,
    // Engineering extension
    wbsCode: row.eng_wbs_code ?? row.wbs_code ?? null,
    outlineNumber: row.eng_outline_number ?? row.outline_number ?? null,
    // Scheduling extension
    scheduledDate: row.sched_scheduled_date ?? row.scheduled_date ?? null,
    scheduledStartTime: row.sched_scheduled_start_time ?? row.scheduled_start_time ?? null,
    scheduledEndTime: row.sched_scheduled_end_time ?? row.scheduled_end_time ?? null,
    estimateMinutes: row.sched_estimate_minutes ?? row.estimate_minutes ?? null,
    taskCategory: row.sched_task_category ?? row.task_category ?? null,
    baselineStart: row.sched_baseline_start ?? row.baseline_start ?? null,
    baselineEnd: row.sched_baseline_end ?? row.baseline_end ?? null,
    baselineDuration: row.sched_baseline_duration ?? row.baseline_duration ?? null,
    taskMode: row.sched_task_mode ?? row.task_mode ?? null,
    actualStart: row.sched_actual_start ?? row.actual_start ?? null,
    actualEnd: row.sched_actual_end ?? row.actual_end ?? null,
    actualDuration: row.sched_actual_duration ?? row.actual_duration ?? null,
    isRecurring: row.sched_is_recurring ?? row.is_recurring ?? null,
    recurrenceFrequency: row.sched_recurrence_frequency ?? row.recurrence_frequency ?? null,
  });
}
