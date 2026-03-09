import { TASK_STATUSES, type TaskStatus } from "./schema";

export const TASK_TYPE_KEYS = ["engineering", "quality", "pm", "approval", "deliverable"] as const;
export type TaskTypeKey = typeof TASK_TYPE_KEYS[number];

export const TASK_WORKFLOW_TYPE_KEYS = [...TASK_TYPE_KEYS] as const;
export type TaskWorkflowType = typeof TASK_WORKFLOW_TYPE_KEYS[number];

export type ReportingBucket = "engineering_execution" | "quality_assurance" | "project_management" | "approvals" | "deliverables";

export interface TaskWorkflowConfig {
  key: TaskWorkflowType;
  label: string;
  defaultStatus: TaskStatus;
  defaultStatuses: readonly TaskStatus[];
  allowedTransitions: Partial<Record<TaskStatus, readonly TaskStatus[]>>;
  requiredFields: readonly string[];
  reportingBucket: ReportingBucket;
  icon?: string;
  color?: string;
}

const ENGINEERING_DEFAULT_STATUSES = [...TASK_STATUSES] as readonly TaskStatus[];

const ENGINEERING_ALLOWED_TRANSITIONS: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
  "TO DO": ["IN PROGRESS", "HOLD", "PROJECTS ASSISTANCE", "NEEDS APPROVAL", "COMPLETE"],
  "IN PROGRESS": ["TO DO", "HOLD", "PROJECTS ASSISTANCE", "NEEDS APPROVAL", "COMPLETE"],
  "HOLD": ["TO DO", "IN PROGRESS", "PROJECTS ASSISTANCE", "NEEDS APPROVAL"],
  "PROJECTS ASSISTANCE": ["TO DO", "IN PROGRESS", "HOLD", "NEEDS APPROVAL"],
  "NEEDS APPROVAL": ["PROVIDE FEEDBACK", "QC APPROVED", "OPERATIONAL APPROVAL", "IN PROGRESS"],
  "PROVIDE FEEDBACK": ["TO DO", "IN PROGRESS", "NEEDS APPROVAL", "HOLD"],
  "QC APPROVED": ["COMPLETE", "IN PROGRESS", "OPERATIONAL APPROVAL"],
  "OPERATIONAL APPROVAL": ["QC APPROVED", "PROVIDE FEEDBACK", "IN PROGRESS", "COMPLETE"],
  "COMPLETE": ["TO DO", "IN PROGRESS", "HOLD"],
};

const ENGINEERING_WORKFLOW: TaskWorkflowConfig = {
  key: "engineering",
  label: "Engineering",
  defaultStatus: "TO DO",
  defaultStatuses: ENGINEERING_DEFAULT_STATUSES,
  allowedTransitions: ENGINEERING_ALLOWED_TRANSITIONS,
  requiredFields: ["title"],
  reportingBucket: "engineering_execution",
  icon: "wrench",
  color: "blue",
};

export const TASK_WORKFLOW_CONFIG: Record<TaskWorkflowType, TaskWorkflowConfig> = {
  engineering: ENGINEERING_WORKFLOW,
  quality: {
    ...ENGINEERING_WORKFLOW,
    key: "quality",
    label: "Quality",
    reportingBucket: "quality_assurance",
    icon: "clipboard-check",
    color: "emerald",
  },
  pm: {
    ...ENGINEERING_WORKFLOW,
    key: "pm",
    label: "Project Management",
    reportingBucket: "project_management",
    icon: "briefcase",
    color: "indigo",
  },
  approval: {
    ...ENGINEERING_WORKFLOW,
    key: "approval",
    label: "Approval",
    reportingBucket: "approvals",
    icon: "shield-check",
    color: "amber",
  },
  deliverable: {
    ...ENGINEERING_WORKFLOW,
    key: "deliverable",
    label: "Deliverable",
    reportingBucket: "deliverables",
    icon: "package-check",
    color: "purple",
  },
};

export const DEFAULT_TASK_WORKFLOW_TYPE: TaskWorkflowType = "engineering";

export function isTaskWorkflowType(value: string | null | undefined): value is TaskWorkflowType {
  if (!value) return false;
  return (TASK_WORKFLOW_TYPE_KEYS as readonly string[]).includes(value);
}

export function resolveTaskWorkflowType(taskType?: string | null, taskWorkflowType?: string | null): TaskWorkflowType {
  if (isTaskWorkflowType(taskWorkflowType)) return taskWorkflowType;
  if (isTaskWorkflowType(taskType)) return taskType;
  return DEFAULT_TASK_WORKFLOW_TYPE;
}

export function getTaskWorkflowConfig(taskType?: string | null, taskWorkflowType?: string | null): TaskWorkflowConfig {
  const resolvedType = resolveTaskWorkflowType(taskType, taskWorkflowType);
  return TASK_WORKFLOW_CONFIG[resolvedType];
}
