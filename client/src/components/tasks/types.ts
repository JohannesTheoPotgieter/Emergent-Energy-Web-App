export interface TaskResolvedUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

export interface TaskDeliverableLink {
  id: number;
  title: string;
  status: string;
  updatedAt: string | null;
}

export interface TaskMicrosoftContextItem {
  id: number;
  linkedTaskId: number | null;
  type: string;
  title: string | null;
  webLink: string | null;
  actionRequired: boolean;
  receivedOrStartDatetime: string | null;
  sourceHref: string | null;
  sourceContextLabel: string | null;
  externalHref: string | null;
}

export interface Task {
  id: number;
  workItemId?: number | null;
  canonical?: boolean;
  projectId?: number | null;
  projectName: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  phase: string | null;
  primaryWorkstream: string | null;
  ownerUserId: number | null;
  approverUserId: number | null;
  assigneeUserId?: number | null;
  assigneeUserIds?: number[] | null;
  dueDate: string | null;
  startDate: string | null;
  percentComplete: number;
  holdReason: string | null;
  blockedType: string | null;
  approvalRequired?: boolean | null;
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
  resolvedOwner?: TaskResolvedUser | null;
  resolvedAssignees?: TaskResolvedUser[] | null;
  isUnassigned?: boolean;
  isBlocked?: boolean;
  isReviewNeeded?: boolean;
  isApprovalPending?: boolean;
  projectLinkedDeliverableCount?: number;
  approvalPendingDeliverableCount?: number;
  projectLinkedDeliverables?: TaskDeliverableLink[] | null;
  deliverableContextHref?: string | null;
  deliverableContextLabel?: string | null;
  projectHref?: string | null;
  sourceHref?: string | null;
  sourceContextLabel?: string | null;
  externalHref?: string | null;
  hasMicrosoftContext?: boolean;
  microsoftActionRequiredCount?: number;
  relatedMicrosoftItems?: TaskMicrosoftContextItem[] | null;
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
  viewMode: "board" | "list" | "projects" | "mytasks" | "timeline";
  statusFilter: string;
  priorityFilter: string;
  assigneeFilter: string;
  projectFilter?: string;
  dueDateFilter?: string;
  workloadStateFilter?: string;
  linkedSourceFilter?: string;
  boardCompact: boolean;
}
