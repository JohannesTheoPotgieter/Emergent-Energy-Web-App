import {
  DELIVERABLE_STATUSES,
  LEGACY_TO_LIFECYCLE,
  LIFECYCLE_PHASES,
  PHASE_TEXT_TO_ENUM,
  PROJECT_PHASE_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./schema";
import { KPI_DEFINITIONS } from "./kpi-definitions";

export const PLATFORM_DEPARTMENT_IDS = [
  "project",
  "finance",
  "engineering",
  "quality",
  "procurement",
  "construction",
  "commissioning",
  "handover",
  "governance",
] as const;
export type PlatformDepartmentId = typeof PLATFORM_DEPARTMENT_IDS[number];

export const PLATFORM_ROLE_IDS = [
  "admin",
  "member",
  "viewer",
  "quality_manager",
  "eng_program_manager",
  "COO_ADMIN",
  "CEO_ADMIN",
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
  "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER",
  "QUALITY_MANAGER",
  "ENGINEERING_MANAGER",
  "KEY_ACCOUNTS_MANAGER",
  "ACCOUNTANT",
  "ENGINEER",
  "PROJECT_DEVELOPER",
] as const;
export type PlatformRoleId = typeof PLATFORM_ROLE_IDS[number];

export const PLATFORM_STATUS_CONVENTIONS = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "complete",
  "cancelled",
] as const;
export type PlatformStatusConvention = typeof PLATFORM_STATUS_CONVENTIONS[number];

export const PLATFORM_PRIORITY_CONVENTIONS = [
  "CRITICAL",
  "HIGH",
  "NORMAL",
  "LOW",
] as const;
export type PlatformPriorityConvention = typeof PLATFORM_PRIORITY_CONVENTIONS[number];

export const WORKFLOW_ACTION_STATES = [
  "pending",
  "in_review",
  "approved",
  "rejected",
  "complete",
  "cancelled",
] as const;
export type WorkflowActionState = typeof WORKFLOW_ACTION_STATES[number];

export const ASSIGNMENT_ROLES = ["OWNER", "ASSIGNEE", "REVIEWER", "VIEWER"] as const;
export type AssignmentRole = typeof ASSIGNMENT_ROLES[number];
export const ASSIGNEE_TYPES = ["internal_user", "external_counterparty", "external_contact"] as const;
export type AssigneeType = typeof ASSIGNEE_TYPES[number];

export interface ApiErrorResponseContract {
  error: string;
  code: string;
  type: string;
  message: string;
  details?: Record<string, unknown>;
  nextAction?: string;
}

export interface ProjectSpineContract {
  canonicalProjectId: number;
  projectInfoId: number;
  projectName: string;
  clientId: number | null;
  clientName: string | null;
  lifecycleStage: string | null;
  lifecycleStageLabel: string | null;
  rawPhase: string | null;
  executionPhase: string | null;
  pmUserId: number | null;
  pdUserId: number | null;
  pmName: string | null;
  pdName: string | null;
  isActive: boolean;
  authoritativeTable: "project_info";
}

export interface DepartmentWorkspaceContract {
  departmentId: PlatformDepartmentId;
  projectId: number;
  lifecycleStage: string | null;
  readEntities: string[];
  writeEntities: string[];
  authoritativeServices: string[];
}

export interface SharedAssigneeContract {
  assignmentRole: AssignmentRole;
  assigneeType: AssigneeType;
  assigneeId: number | null;
  userId: number | null;
  counterpartyId: number | null;
  contactId: number | null;
  roleId: PlatformRoleId | string | null;
  displayName: string | null;
  displayLabelSnapshot?: string | null;
  sourceTable: string;
  sourceEntityType: string;
  sourceEntityId: string;
  canonical: boolean;
}

export interface SharedWorkItemContract {
  workItemId: number;
  projectId: number;
  workstream: string;
  title: string;
  status: PlatformStatusConvention;
  priority: PlatformPriorityConvention;
  ownerUserId: number | null;
  authoritativeTable: "work_items";
  authoritativeAssignmentTable: "work_item_assignments";
}

export interface SharedWorkflowActionContract {
  actionType: "approval" | "deliverable";
  recordId: number;
  projectId: number;
  status: WorkflowActionState;
  sourceTable: "approvals" | "deliverables";
  title: string | null;
  assignedUserId: number | null;
  requestedByUserId: number | null;
  decidedByUserId: number | null;
  dueDate: string | null;
  phase: string | null;
}

export interface SharedLatestUpdateContract {
  projectId: number;
  text: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  sourceTable: "project_editable_fields";
}

export interface SharedActivityContract {
  projectId: number;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  lastActivityActor: string | null;
  sourceTable: "audit_events" | "project_editable_fields" | "project_phase_history";
}

export interface SharedKpiContract {
  id: string;
  name: string;
  value: number;
  unit: "count" | "currency" | "percent";
  sourceTable: string;
  sourceService: string;
}

export interface PlatformProjectSummaryContract {
  project: ProjectSpineContract;
  workspaces: DepartmentWorkspaceContract[];
  assignees: SharedAssigneeContract[];
  latestUpdate: SharedLatestUpdateContract;
  activity: SharedActivityContract;
  workflow: {
    approvals: {
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    };
    deliverables: {
      total: number;
      pending: number;
      inReview: number;
      completed: number;
    };
  };
  kpis: SharedKpiContract[];
}

export const PLATFORM_AUTHORITATIVE_SOURCES = {
  projectSpine: {
    table: "project_info",
    service: "project-platform-summary-service",
    notes: "Canonical project identity and lifecycle state.",
  },
  latestUpdate: {
    table: "project_editable_fields",
    service: "project-platform-summary-service",
    notes: "Single latest update comment per project.",
  },
  workItems: {
    table: "work_items",
    service: "project-platform-summary-service",
    notes: "Canonical shared work item spine.",
  },
  assignees: {
    table: "work_item_assignments",
    service: "project-platform-summary-service",
    notes: "Canonical shared assignee model with work_items owner fallback.",
  },
  approvals: {
    table: "approvals",
    service: "project-platform-summary-service",
    notes: "Canonical approval action ledger.",
  },
  deliverables: {
    table: "deliverables",
    service: "project-platform-summary-service",
    notes: "Canonical deliverable completion ledger.",
  },
  activity: {
    table: "audit_events",
    service: "project-platform-summary-service",
    notes: "Mandatory auditable mutation trail.",
  },
  kpis: {
    table: "shared/kpi-definitions",
    service: "canonical-dashboard-kpi-service",
    notes: "Canonical KPI definitions and shared summary aggregations.",
  },
} as const;

export const PLATFORM_EXTENSION_RULES = [
  "Anchor every new project-facing feature to project_info.id.",
  "Reuse work_items, work_item_assignments, approvals, and deliverables before adding a new workflow table.",
  "Add backend-enforced lifecycle, status, and approval rules before any frontend affordance ships.",
  "Emit audit_events for every major mutation and project timeline events when the change affects project state.",
  "Expose cross-department summary data through shared services or platform endpoints, never page-local bespoke joins.",
  "Document authoritative tables, services, and route ownership for every new platform-facing module.",
] as const;

const ROLE_ALIAS_MAP: Record<string, PlatformRoleId | string> = {
  quality_manager: "QUALITY_MANAGER",
};

const DEPARTMENT_ALIAS_MAP: Record<string, PlatformDepartmentId> = {
  pm: "project",
  project: "project",
  projects: "project",
  finance: "finance",
  engineering: "engineering",
  eng: "engineering",
  quality: "quality",
  qa: "quality",
  procurement: "procurement",
  construction: "construction",
  commissioning: "commissioning",
  handover: "handover",
  governance: "governance",
};

const STATUS_ALIAS_MAP: Record<string, PlatformStatusConvention> = {
  "to do": "todo",
  todo: "todo",
  "not started": "todo",
  new: "todo",
  open: "todo",
  planned: "todo",
  "in progress": "in_progress",
  active: "in_progress",
  pending: "in_progress",
  started: "in_progress",
  blocked: "blocked",
  hold: "blocked",
  "on hold": "blocked",
  waiting: "blocked",
  review: "review",
  "needs approval": "review",
  "provide feedback": "review",
  "qc approved": "review",
  "operational approval": "review",
  complete: "complete",
  completed: "complete",
  done: "complete",
  approved: "complete",
  cancelled: "cancelled",
  canceled: "cancelled",
  archived: "cancelled",
};

const PRIORITY_ALIAS_MAP: Record<string, PlatformPriorityConvention> = {
  urgent: "CRITICAL",
  critical: "CRITICAL",
  p1: "CRITICAL",
  high: "HIGH",
  p2: "HIGH",
  med: "NORMAL",
  medium: "NORMAL",
  normal: "NORMAL",
  p3: "NORMAL",
  low: "LOW",
  p4: "LOW",
};

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function normalizeLifecycleStage(value: string | null | undefined): {
  lifecycleStage: string | null;
  phaseLabel: string | null;
  rawPhase: string | null;
} {
  const rawPhase = cleanText(value) || null;
  if (!rawPhase) {
    return { lifecycleStage: null, phaseLabel: null, rawPhase: null };
  }

  const mappedPhase = PHASE_TEXT_TO_ENUM[rawPhase.toLowerCase()] || rawPhase;
  const lifecycleStage = LEGACY_TO_LIFECYCLE[mappedPhase] || mappedPhase;
  const phaseLabel = PROJECT_PHASE_LABELS[mappedPhase] || PROJECT_PHASE_LABELS[lifecycleStage] || lifecycleStage;

  return {
    lifecycleStage,
    phaseLabel,
    rawPhase,
  };
}

export function normalizeDepartmentId(value: string | null | undefined): PlatformDepartmentId {
  const cleaned = cleanText(value).toLowerCase();
  return DEPARTMENT_ALIAS_MAP[cleaned] || "project";
}

export function normalizeRoleId(value: string | null | undefined): PlatformRoleId | string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  return ROLE_ALIAS_MAP[cleaned] || cleaned;
}

export function normalizePlatformStatus(value: string | null | undefined): PlatformStatusConvention {
  const cleaned = cleanText(value).toLowerCase();
  return STATUS_ALIAS_MAP[cleaned] || "todo";
}

export function normalizePlatformPriority(value: string | null | undefined): PlatformPriorityConvention {
  const cleaned = cleanText(value).toLowerCase();
  return PRIORITY_ALIAS_MAP[cleaned] || "NORMAL";
}

export function normalizeWorkflowActionState(
  actionType: "approval" | "deliverable",
  value: string | null | undefined,
): WorkflowActionState {
  const cleaned = cleanText(value).toLowerCase();

  if (actionType === "approval") {
    if (cleaned === "approved") return "approved";
    if (cleaned === "rejected") return "rejected";
    return "pending";
  }

  if (cleaned === "complete" || cleaned === "completed") return "complete";
  if (cleaned === "cancelled" || cleaned === "canceled") return "cancelled";
  if (cleaned === "provide feedback" || cleaned === "needs approval" || cleaned === "qc approved" || cleaned === "operational approval") {
    return "in_review";
  }
  if (cleaned === "rejected") return "rejected";
  return "pending";
}

export function createDepartmentWorkspaceContracts(
  projectId: number,
  lifecycleStage: string | null,
): DepartmentWorkspaceContract[] {
  return [
    {
      departmentId: "project",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "work_items", "approvals", "deliverables"],
      writeEntities: ["project_spine", "latest_update", "work_items"],
      authoritativeServices: ["project-platform-summary-service", "lifecycle-stage-gate-service"],
    },
    {
      departmentId: "finance",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "approvals", "deliverables"],
      writeEntities: ["approvals"],
      authoritativeServices: ["project-platform-summary-service", "canonical-dashboard-kpi-service"],
    },
    {
      departmentId: "engineering",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "work_items", "approvals", "deliverables"],
      writeEntities: ["work_items", "deliverables", "approvals"],
      authoritativeServices: ["project-platform-summary-service", "lifecycle-stage-gate-service"],
    },
    {
      departmentId: "quality",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "work_items", "approvals", "deliverables"],
      writeEntities: ["approvals", "deliverables"],
      authoritativeServices: ["project-platform-summary-service", "lifecycle-stage-gate-service"],
    },
    {
      departmentId: "procurement",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "approvals"],
      writeEntities: ["approvals"],
      authoritativeServices: ["project-platform-summary-service"],
    },
    {
      departmentId: "construction",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "work_items", "deliverables"],
      writeEntities: ["work_items", "deliverables"],
      authoritativeServices: ["project-platform-summary-service"],
    },
    {
      departmentId: "commissioning",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "approvals", "deliverables"],
      writeEntities: ["approvals", "deliverables"],
      authoritativeServices: ["project-platform-summary-service"],
    },
    {
      departmentId: "handover",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "approvals", "deliverables"],
      writeEntities: ["approvals", "deliverables"],
      authoritativeServices: ["project-platform-summary-service", "lifecycle-stage-gate-service"],
    },
    {
      departmentId: "governance",
      projectId,
      lifecycleStage,
      readEntities: ["project_spine", "latest_update", "activity", "kpis", "approvals", "deliverables"],
      writeEntities: ["project_spine", "latest_update"],
      authoritativeServices: ["project-platform-summary-service", "lifecycle-stage-gate-service"],
    },
  ];
}

export function buildPlatformKpiDefinitions(): SharedKpiContract[] {
  return Object.values(KPI_DEFINITIONS).map((definition) => ({
    id: definition.id,
    name: definition.name,
    value: 0,
    unit: definition.id.includes("pct") || definition.id.includes("margin") ? "percent" : definition.id.includes("revenue") ? "currency" : "count",
    sourceTable: definition.sourceTable,
    sourceService: definition.aggregationPath,
  }));
}

export function listPlatformContractReferences() {
  return {
    lifecyclePhases: [...LIFECYCLE_PHASES],
    taskStatuses: [...TASK_STATUSES],
    taskPriorities: [...TASK_PRIORITIES],
    deliverableStatuses: [...DELIVERABLE_STATUSES],
    departments: [...PLATFORM_DEPARTMENT_IDS],
    roles: [...PLATFORM_ROLE_IDS],
  };
}
