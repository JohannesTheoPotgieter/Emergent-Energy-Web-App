export interface Task {
  id: number;
  projectName: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  phase: string | null;
  primaryWorkstream: string | null;
  ownerUserId: number | null;
  approverUserId: number | null;
  assigneeUserId?: number | null;
  dueDate: string | null;
  startDate: string | null;
  percentComplete: number;
  holdReason: string | null;
  blockedType: string | null;
  trackingRag: string | null;
  summaryText: string | null;
  taskTypeTag: string | null;
  externalSource: string | null;
  externalTaskId: string | null;
  parentTaskId: number | null;
  linkedPlanItemId: number | null;
  linkedDeliverableId: number | null;
  linkedQualityItemInstanceId: number | null;
  assignees: string[] | null;
  watchers: string[] | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: number;
  taskId: number;
  authorId: number | null;
  body: string;
  createdAt: string;
  authorName?: string;
}

export interface ActivityEntry {
  id: number;
  taskId: number;
  actorId: number | null;
  actionType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  actorName?: string;
}

export interface TeamMember {
  id: number;
  fullName: string;
  role: string;
}

export interface EngDefaultView {
  viewMode: "board" | "list" | "projects" | "mytasks";
  statusFilter: string;
  priorityFilter: string;
  assigneeFilter: string;
  boardCompact: boolean;
}
