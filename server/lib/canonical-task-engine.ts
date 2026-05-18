import {
  PLATFORM_PRIORITY_CONVENTIONS,
  PLATFORM_STATUS_CONVENTIONS,
  normalizePlatformPriority,
  normalizePlatformStatus,
} from "@shared/platform-contracts";

export const CANONICAL_PRIORITIES = PLATFORM_PRIORITY_CONVENTIONS;
export const CANONICAL_STATUSES = PLATFORM_STATUS_CONVENTIONS;

export type CanonicalStatus = typeof CANONICAL_STATUSES[number];

export const STATUS_LABELS: Record<CanonicalStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  review: "Review",
  complete: "Complete",
  cancelled: "Cancelled",
};

export function normalizeStatus(status: string | null | undefined): CanonicalStatus {
  return normalizePlatformStatus(status);
}

export type CanonicalPriority = typeof CANONICAL_PRIORITIES[number];

export function normalizePriority(priority: string | null | undefined): CanonicalPriority {
  return normalizePlatformPriority(priority);
}

export const CANONICAL_TASK_TYPES = ["personal", "operational", "plan", "engineering", "quality"] as const;
export type CanonicalTaskType = typeof CANONICAL_TASK_TYPES[number];

export const CANONICAL_WORKSTREAMS = ["PM", "ENG", "QUALITY"] as const;

export interface CanonicalTask {
  task_id: number;
  project_id: number | null;
  project_name: string | null;
  task_type: CanonicalTaskType;
  title: string;
  description: string | null;
  status: CanonicalStatus;
  priority: CanonicalPriority;
  owner_user_id: number | null;
  assignee_user_id: number | null;
  viewer_user_ids: number[];
  reviewer_user_id: number | null;
  due_date: string | null;
  workstream: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  percent_complete: number | null;
  source_table: string;
  source_id: number;
}

/**
 * Source rows arrive from several adapters — some via Drizzle (camelCase
 * columns) and some via raw SQL (snake_case columns). The functions below
 * read both spellings, so the input is modelled as an open string-keyed
 * record and coerced through the small helpers below.
 */
type TaskSourceRow = Record<string, unknown>;

function asNum(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

function asNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : String(v);
}

/** First non-null/undefined value, returned as-is for further coercion. */
function firstDefined(...vals: unknown[]): unknown {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

export function fromWorkItem(wi: TaskSourceRow, projectName?: string | null): CanonicalTask {
  return {
    task_id: asNum(wi.id),
    project_id: asNumOrNull(firstDefined(wi.projectId, wi.project_id)),
    project_name: projectName || asStrOrNull(wi.project_name),
    task_type: "plan",
    title: asStr(firstDefined(wi.title, wi.task_name)),
    description: asStrOrNull(firstDefined(wi.description, wi.comment)),
    status: normalizeStatus(asStrOrNull(wi.status)),
    priority: normalizePriority(asStrOrNull(wi.priority)),
    owner_user_id: asNumOrNull(firstDefined(wi.ownerUserId, wi.owner_user_id)),
    assignee_user_id: asNumOrNull(firstDefined(wi.ownerUserId, wi.owner_user_id, wi.assignee_user_id)),
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: asStrOrNull(firstDefined(wi.endDate, wi.end_date, wi.dueDate, wi.due_date)),
    workstream: asStrOrNull(wi.workstream) || "PM",
    created_by: null,
    updated_by: null,
    created_at: asStrOrNull(firstDefined(wi.createdAt, wi.created_at)),
    updated_at: asStrOrNull(firstDefined(wi.updatedAt, wi.updated_at)),
    percent_complete: asNumOrNull(firstDefined(wi.percentComplete, wi.percent_complete, wi.pct_complete)),
    source_table: "work_items",
    source_id: asNum(wi.id),
  };
}

export function fromOperational(t: TaskSourceRow): CanonicalTask {
  return {
    task_id: asNum(t.id),
    project_id: asNumOrNull(firstDefined(t.projectId, t.project_id)),
    project_name: asStrOrNull(firstDefined(t.projectName, t.project_name)),
    task_type: "operational",
    title: asStr(t.title),
    description: asStrOrNull(firstDefined(t.description, t.notes)),
    status: normalizeStatus(asStrOrNull(t.status)),
    priority: normalizePriority(asStrOrNull(t.priority)),
    owner_user_id: asNumOrNull(firstDefined(t.ownerUserId, t.owner_user_id)),
    assignee_user_id: asNumOrNull(firstDefined(t.ownerUserId, t.owner_user_id)),
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: asStrOrNull(firstDefined(t.dueDate, t.due_date)),
    workstream: asStrOrNull(t.workstream) || "PM",
    created_by: asNumOrNull(firstDefined(t.createdBy, t.created_by)),
    updated_by: null,
    created_at: asStrOrNull(firstDefined(t.createdAt, t.created_at)),
    updated_at: asStrOrNull(firstDefined(t.updatedAt, t.updated_at)),
    percent_complete: asNumOrNull(firstDefined(t.percentComplete, t.percent_complete)),
    source_table: "work_items",
    source_id: asNum(t.id),
  };
}

export function fromEngineering(t: TaskSourceRow): CanonicalTask {
  return {
    task_id: asNum(t.id),
    project_id: asNumOrNull(firstDefined(t.projectId, t.project_id)),
    project_name: asStrOrNull(firstDefined(t.projectName, t.project_name)),
    task_type: "engineering",
    title: asStr(t.title),
    description: asStrOrNull(t.description),
    status: normalizeStatus(asStrOrNull(t.status)),
    priority: normalizePriority(asStrOrNull(t.priority)),
    owner_user_id: asNumOrNull(firstDefined(t.assigneeUserId, t.assignee_user_id)),
    assignee_user_id: asNumOrNull(firstDefined(t.assigneeUserId, t.assignee_user_id)),
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: asStrOrNull(firstDefined(t.dueDate, t.due_date)),
    workstream: "ENG",
    created_by: null,
    updated_by: null,
    created_at: asStrOrNull(firstDefined(t.createdAt, t.created_at)),
    updated_at: asStrOrNull(firstDefined(t.updatedAt, t.updated_at)),
    percent_complete: null,
    source_table: "work_items",
    source_id: asNum(t.id),
  };
}

export function fromPersonal(t: TaskSourceRow): CanonicalTask {
  return {
    task_id: asNum(t.id),
    project_id: null,
    project_name: asStrOrNull(firstDefined(t.projectName, t.project_name)),
    task_type: "personal",
    title: asStr(t.title),
    description: asStrOrNull(firstDefined(t.description, t.notes)),
    status: normalizeStatus(asStrOrNull(t.status)),
    priority: normalizePriority(asStrOrNull(t.priority)),
    owner_user_id: asNumOrNull(firstDefined(t.ownerUserId, t.owner_user_id)),
    assignee_user_id: asNumOrNull(firstDefined(t.ownerUserId, t.owner_user_id)),
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: asStrOrNull(firstDefined(t.dueDate, t.due_date)),
    workstream: null,
    created_by: asNumOrNull(firstDefined(t.ownerUserId, t.owner_user_id)),
    updated_by: null,
    created_at: asStrOrNull(firstDefined(t.createdAt, t.created_at)),
    updated_at: asStrOrNull(firstDefined(t.updatedAt, t.updated_at)),
    percent_complete: null,
    source_table: "mytool_tasks",
    source_id: asNum(t.id),
  };
}

/**
 * B7: Extended workstreams to include construction
 */
export const EXTENDED_CANONICAL_WORKSTREAMS = ["PM", "ENG", "QUALITY", "CONSTRUCTION", "PROCUREMENT"] as const;

export function fromConstruction(t: TaskSourceRow): CanonicalTask {
  return {
    task_id: asNum(t.id),
    project_id: asNumOrNull(firstDefined(t.projectId, t.project_id)),
    project_name: asStrOrNull(firstDefined(t.projectName, t.project_name)),
    task_type: "operational",
    title: asStr(t.title),
    description: asStrOrNull(t.description),
    status: normalizeStatus(asStrOrNull(t.status)),
    priority: normalizePriority(asStrOrNull(firstDefined(t.severity, t.priority))),
    owner_user_id: asNumOrNull(firstDefined(t.assignedToUserId, t.assigned_to_user_id)),
    assignee_user_id: asNumOrNull(firstDefined(t.assignedToUserId, t.assigned_to_user_id)),
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: asStrOrNull(firstDefined(t.dueDate, t.due_date)),
    workstream: "CONSTRUCTION",
    created_by: asNumOrNull(firstDefined(t.reportedByUserId, t.reported_by_user_id)),
    updated_by: null,
    created_at: asStrOrNull(firstDefined(t.createdAt, t.created_at)),
    updated_at: asStrOrNull(firstDefined(t.updatedAt, t.updated_at)),
    percent_complete: null,
    source_table: "snags",
    source_id: asNum(t.id),
  };
}

export function fromQuality(t: TaskSourceRow): CanonicalTask {
  return {
    task_id: asNum(t.id),
    project_id: asNumOrNull(firstDefined(t.projectId, t.project_id)),
    project_name: asStrOrNull(firstDefined(t.projectName, t.project_name)),
    task_type: "quality",
    title: asStr(firstDefined(t.title, t.item_name, t.itemName)),
    description: asStrOrNull(t.notes),
    status: normalizeStatus(asStrOrNull(firstDefined(t.qmStatus, t.qm_status, t.status))),
    priority: normalizePriority(asStrOrNull(t.priority)),
    owner_user_id: asNumOrNull(firstDefined(t.assigneeUserId, t.assignee_user_id)),
    assignee_user_id: asNumOrNull(firstDefined(t.assigneeUserId, t.assignee_user_id)),
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: asStrOrNull(firstDefined(t.endDate, t.end_date)),
    workstream: "QUALITY",
    created_by: null,
    updated_by: null,
    created_at: asStrOrNull(firstDefined(t.createdAt, t.created_at)),
    updated_at: asStrOrNull(firstDefined(t.updatedAt, t.updated_at)),
    percent_complete: null,
    source_table: "qc_item_instance",
    source_id: asNum(t.id),
  };
}
