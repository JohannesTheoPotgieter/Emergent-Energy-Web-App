/**
 * UnifiedTask — Single canonical type for all task data flowing through the app.
 *
 * Replaces the ad-hoc OperationalTask / EngineeringTask / Task / MytoolTask
 * shapes that previously diverged across endpoints. Every field here maps to
 * work_items core + extension tables.
 *
 * Prompt 8 of 15.
 */

// ── Core ────────────────────────────────────────────────────────────

export interface UnifiedTask {
  // Identity
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  workstream: string;
  type: string | null;

  // Hierarchy
  projectId: number | null;
  projectName: string | null;
  parentId: number | null;
  clientId: number | null;

  // Dates (core)
  startDate: string | null;
  endDate: string | null;
  dueDate: string | null; // alias for endDate (legacy compat)
  duration: number | null;

  // Assignment
  ownerUserId: number | null;
  ownerName: string | null;
  createdBy: number | null;
  assigneeUserIds: number[] | null;

  // External reference
  externalRef: string | null;
  source: string | null;
  legacyTable: string | null;
  legacyId: number | null;

  // Metadata
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  deletedAt: string | Date | null;
  sortOrder: number | null;

  // PM extension (from work_item_pm)
  percentComplete: number | null;
  expectedPctComplete: number | null;
  phase: string | null;
  isMilestone: boolean | null;
  indentLevel: number | null;
  isShared: boolean | null;
  holdReason: string | null;
  blockedType: string | null;
  blockerReason: string | null;
  approvalRequired: boolean | null;
  trackingRag: string | null;
  taskTypeTag: string | null;
  subProjectName: string | null;
  completedAt: string | Date | null;
  linkedPlanItemId: number | null;
  linkedDeliverableId: number | null;
  linkedQualityItemInstanceId: number | null;

  // Engineering extension (from work_item_engineering)
  wbsCode: string | null;
  outlineNumber: string | null;

  // Scheduling extension (from work_item_scheduling)
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  estimateMinutes: number | null;
  taskCategory: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  baselineDuration: number | null;
  taskMode: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  actualDuration: number | null;
  isRecurring: boolean | null;
  recurrenceFrequency: string | null;

  // Resolved (populated at query time, not stored)
  resolvedAssignees?: ResolvedUser[] | null;
  resolvedOwner?: ResolvedUser | null;
  canonical?: boolean;
}

export interface ResolvedUser {
  id: number;
  name: string;
  username?: string;
  role?: string;
}

// ── Adapter: work_items row → UnifiedTask ────────────────────────────

/**
 * Convert a work_items row (with optional extension data) into a UnifiedTask.
 *
 * Accepts any object shape since rows may come from raw SQL JOINs, Drizzle
 * selects, or API responses. Uses snake_case OR camelCase field names.
 */
export function fromWorkItem(row: Record<string, any>, overrides?: Partial<UnifiedTask>): UnifiedTask {
  return {
    id: row.id,
    title: row.title ?? "",
    description: row.description ?? null,
    status: row.status ?? "Not Started",
    priority: row.priority ?? null,
    workstream: row.workstream ?? row.work_stream ?? "PM",
    type: row.type ?? null,

    projectId: row.projectId ?? row.project_id ?? null,
    projectName: row.projectName ?? row.project_name ?? null,
    parentId: row.parentId ?? row.parent_id ?? null,
    clientId: row.clientId ?? row.client_id ?? null,

    startDate: row.startDate ?? row.start_date ?? null,
    endDate: row.endDate ?? row.end_date ?? null,
    dueDate: row.endDate ?? row.end_date ?? row.dueDate ?? row.due_date ?? null,
    duration: row.duration ?? null,

    ownerUserId: row.ownerUserId ?? row.owner_user_id ?? null,
    ownerName: row.ownerName ?? row.owner_name ?? null,
    createdBy: row.createdBy ?? row.created_by ?? null,
    assigneeUserIds: row.assigneeUserIds ?? null,

    externalRef: row.externalRef ?? row.external_ref ?? null,
    source: row.source ?? null,
    legacyTable: row.legacyTable ?? row.legacy_table ?? null,
    legacyId: row.legacyId ?? row.legacy_id ?? null,

    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
    sortOrder: row.sortOrder ?? row.sort_order ?? null,

    // PM extension
    percentComplete: row.percentComplete ?? row.percent_complete ?? null,
    expectedPctComplete: row.expectedPctComplete ?? row.expected_pct_complete ?? null,
    phase: row.phase ?? null,
    isMilestone: row.isMilestone ?? row.is_milestone ?? null,
    indentLevel: row.indentLevel ?? row.indent_level ?? null,
    isShared: row.isShared ?? row.is_shared ?? null,
    holdReason: row.holdReason ?? row.hold_reason ?? null,
    blockedType: row.blockedType ?? row.blocked_type ?? null,
    blockerReason: row.blockerReason ?? row.blocker_reason ?? null,
    approvalRequired: row.approvalRequired ?? row.approval_required ?? null,
    trackingRag: row.trackingRag ?? row.tracking_rag ?? null,
    taskTypeTag: row.taskTypeTag ?? row.task_type_tag ?? null,
    subProjectName: row.subProjectName ?? row.sub_project_name ?? null,
    completedAt: row.completedAt ?? row.completed_at ?? null,
    linkedPlanItemId: row.linkedPlanItemId ?? row.linked_plan_item_id ?? null,
    linkedDeliverableId: row.linkedDeliverableId ?? row.linked_deliverable_id ?? null,
    linkedQualityItemInstanceId: row.linkedQualityItemInstanceId ?? row.linked_quality_item_instance_id ?? null,

    // Engineering extension
    wbsCode: row.wbsCode ?? row.wbs_code ?? null,
    outlineNumber: row.outlineNumber ?? row.outline_number ?? null,

    // Scheduling extension
    scheduledDate: row.scheduledDate ?? row.scheduled_date ?? null,
    scheduledStartTime: row.scheduledStartTime ?? row.scheduled_start_time ?? null,
    scheduledEndTime: row.scheduledEndTime ?? row.scheduled_end_time ?? null,
    estimateMinutes: row.estimateMinutes ?? row.estimate_minutes ?? null,
    taskCategory: row.taskCategory ?? row.task_category ?? null,
    baselineStart: row.baselineStart ?? row.baseline_start ?? null,
    baselineEnd: row.baselineEnd ?? row.baseline_end ?? null,
    baselineDuration: row.baselineDuration ?? row.baseline_duration ?? null,
    taskMode: row.taskMode ?? row.task_mode ?? null,
    actualStart: row.actualStart ?? row.actual_start ?? null,
    actualEnd: row.actualEnd ?? row.actual_end ?? null,
    actualDuration: row.actualDuration ?? row.actual_duration ?? null,
    isRecurring: row.isRecurring ?? row.is_recurring ?? null,
    recurrenceFrequency: row.recurrenceFrequency ?? row.recurrence_frequency ?? null,

    canonical: true,
    ...overrides,
  };
}

// ── Backward-compat adapters ─────────────────────────────────────────

/** Map UnifiedTask → legacy OperationalTask shape (response compat) */
export function toOperationalTaskShape(t: UnifiedTask): Record<string, any> {
  return {
    id: t.legacyId ?? t.id,
    workItemId: t.id,
    canonical: true,
    projectId: t.projectId,
    projectName: t.projectName,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority ?? "Med",
    phase: t.phase,
    primaryWorkstream: t.workstream,
    ownerUserId: t.ownerUserId,
    requesterUserId: null,
    approverUserId: null,
    holdReason: t.holdReason,
    blockedType: t.blockedType,
    blockerReason: t.blockerReason,
    approvalRequired: t.approvalRequired ?? false,
    startDate: t.startDate,
    dueDate: t.dueDate,
    durationDays: t.duration,
    actualStartDate: t.actualStart,
    actualEndDate: t.actualEnd,
    actualDurationDays: t.actualDuration,
    completedAt: t.completedAt,
    percentComplete: t.percentComplete ?? 0,
    expectedPercentComplete: t.expectedPctComplete,
    comment: t.description,
    assignees: null,
    assigneeUserIds: t.assigneeUserIds,
    watchers: null,
    tags: null,
    sortOrder: t.sortOrder ?? 0,
    isBaseline: false,
    linkedPlanItemId: t.linkedPlanItemId,
    linkedDeliverableId: t.linkedDeliverableId,
    linkedQualityItemInstanceId: t.linkedQualityItemInstanceId,
    externalSource: null,
    externalTaskId: t.externalRef,
    trackingRag: t.trackingRag,
    summaryText: null,
    taskTypeTag: t.taskTypeTag,
    domain: "BOTH",
    pdTicketId: null,
    createdBy: t.createdBy,
    scheduledDate: t.scheduledDate,
    scheduledStartTime: t.scheduledStartTime,
    scheduledEndTime: t.scheduledEndTime,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    parentTaskId: t.parentId,
    importedTaskId: null,
    taskNumber: t.wbsCode,
  };
}

/** Map UnifiedTask → legacy EngineeringTask shape (response compat) */
export function toEngineeringTaskShape(t: UnifiedTask): Record<string, any> {
  return {
    id: t.id,
    projectId: t.projectId,
    projectName: t.projectName,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority ?? "Medium",
    assigneeUserId: t.ownerUserId,
    assigneeName: t.ownerName,
    scheduledDate: t.scheduledDate,
    scheduledStartTime: t.scheduledStartTime,
    scheduledEndTime: t.scheduledEndTime,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
