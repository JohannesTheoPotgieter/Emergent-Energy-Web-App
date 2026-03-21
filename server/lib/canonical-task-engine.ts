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

export function fromWorkItem(wi: any, projectName?: string | null): CanonicalTask {
  return {
    task_id: wi.id,
    project_id: wi.projectId || wi.project_id || null,
    project_name: projectName || wi.project_name || null,
    task_type: "plan",
    title: wi.title || wi.task_name || "",
    description: wi.description || wi.comment || null,
    status: normalizeStatus(wi.status),
    priority: normalizePriority(wi.priority),
    owner_user_id: wi.ownerUserId || wi.owner_user_id || null,
    assignee_user_id: wi.ownerUserId || wi.owner_user_id || wi.assignee_user_id || null,
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: wi.endDate || wi.end_date || wi.dueDate || wi.due_date || null,
    workstream: wi.workstream || "PM",
    created_by: null,
    updated_by: null,
    created_at: wi.createdAt || wi.created_at || null,
    updated_at: wi.updatedAt || wi.updated_at || null,
    percent_complete: wi.percentComplete ?? wi.percent_complete ?? wi.pct_complete ?? null,
    source_table: "work_items",
    source_id: wi.id,
  };
}

export function fromOperational(t: any): CanonicalTask {
  return {
    task_id: t.id,
    project_id: t.projectId || t.project_id || null,
    project_name: t.projectName || t.project_name || null,
    task_type: "operational",
    title: t.title || "",
    description: t.description || t.notes || null,
    status: normalizeStatus(t.status),
    priority: normalizePriority(t.priority),
    owner_user_id: t.ownerUserId || t.owner_user_id || null,
    assignee_user_id: t.ownerUserId || t.owner_user_id || null,
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: t.dueDate || t.due_date || null,
    workstream: t.workstream || "PM",
    created_by: t.createdBy || t.created_by || null,
    updated_by: null,
    created_at: t.createdAt || t.created_at || null,
    updated_at: t.updatedAt || t.updated_at || null,
    percent_complete: t.percentComplete ?? t.percent_complete ?? null,
    source_table: "work_items",
    source_id: t.id,
  };
}

export function fromEngineering(t: any): CanonicalTask {
  return {
    task_id: t.id,
    project_id: t.projectId || t.project_id || null,
    project_name: t.projectName || t.project_name || null,
    task_type: "engineering",
    title: t.title || "",
    description: t.description || null,
    status: normalizeStatus(t.status),
    priority: normalizePriority(t.priority),
    owner_user_id: t.assigneeUserId || t.assignee_user_id || null,
    assignee_user_id: t.assigneeUserId || t.assignee_user_id || null,
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: t.dueDate || t.due_date || null,
    workstream: "ENG",
    created_by: null,
    updated_by: null,
    created_at: t.createdAt || t.created_at || null,
    updated_at: t.updatedAt || t.updated_at || null,
    percent_complete: null,
    source_table: "work_items",
    source_id: t.id,
  };
}

export function fromPersonal(t: any): CanonicalTask {
  return {
    task_id: t.id,
    project_id: null,
    project_name: t.projectName || t.project_name || null,
    task_type: "personal",
    title: t.title || "",
    description: t.description || t.notes || null,
    status: normalizeStatus(t.status),
    priority: normalizePriority(t.priority),
    owner_user_id: t.ownerUserId || t.owner_user_id || null,
    assignee_user_id: t.ownerUserId || t.owner_user_id || null,
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: t.dueDate || t.due_date || null,
    workstream: null,
    created_by: t.ownerUserId || t.owner_user_id || null,
    updated_by: null,
    created_at: t.createdAt || t.created_at || null,
    updated_at: t.updatedAt || t.updated_at || null,
    percent_complete: null,
    source_table: "mytool_tasks",
    source_id: t.id,
  };
}

export function fromQuality(t: any): CanonicalTask {
  return {
    task_id: t.id,
    project_id: t.projectId || t.project_id || null,
    project_name: t.projectName || t.project_name || null,
    task_type: "quality",
    title: t.title || t.item_name || t.itemName || "",
    description: t.notes || null,
    status: normalizeStatus(t.qmStatus || t.qm_status || t.status),
    priority: normalizePriority(t.priority),
    owner_user_id: t.assigneeUserId || t.assignee_user_id || null,
    assignee_user_id: t.assigneeUserId || t.assignee_user_id || null,
    viewer_user_ids: [],
    reviewer_user_id: null,
    due_date: t.endDate || t.end_date || null,
    workstream: "QUALITY",
    created_by: null,
    updated_by: null,
    created_at: t.createdAt || t.created_at || null,
    updated_at: t.updatedAt || t.updated_at || null,
    percent_complete: null,
    source_table: "qc_item_instance",
    source_id: t.id,
  };
}
