/**
 * Shared client-side shapes for priority data.
 *
 * The server's `enrichPriority` helper produces the same fields everywhere,
 * so the client can rely on this contract rather than duplicating a loose
 * `any`-typed shape in each page. Matches the envelope built in
 * `server/departments/priority-strategic-routes.ts :: enrichPriority`.
 */

export type PriorityScope = "company" | "department" | "role";
export type PriorityHealth = "healthy" | "at_risk" | "critical";

export interface PriorityUserRef {
  id: number;
  name: string;
}

export interface PriorityRow {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  severity: string;
  status: string;
  dueDate: string | null;
  assignedTo: string | null;
  sortOrder: number;
  manualHealth: string | null;
  manualProgress: number | null;
  progressSourceType: string | null;
  progressSourceRef: {
    projectId?: number;
    phaseCode?: string;
    milestoneId?: number;
    workItemIds?: number[];
  } | null;
  progressSource: {
    type: string;
    ref: any;
    value: number | null;
    label: string;
  } | null;
  targetStartDate: string | null;
  targetOutcome: string | null;
  owner: PriorityUserRef | null;
  accountableExec: PriorityUserRef | null;
  assignedUser: PriorityUserRef | null;
  effectiveHealth: PriorityHealth | string;
  effectiveProgress: number;
  healthReasons?: string[];
  projectCount: number;
  atRiskProjectCount: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  blockerCount: number;
  openTaskCount: number;
  engBlockerCount?: number;
  qualityDefectCount?: number;
  hseIncidentCount?: number;
  hseCriticalCount?: number;
  opportunityCount?: number;
  staleOpportunityCount?: number;
  openPdTicketCount?: number;
  hasProjects: boolean;
  scope: PriorityScope | string;
  parentId: number | null;
  departmentKey: string | null;
  assignedUserId: number | null;
  escalated: boolean;
  escalatedAt: string | null;
  escalationReason: string | null;
  childCount: number;
  parentTitle: string | null;
  /**
   * FK to work_items.id when this priority was promoted from a task via
   * POST /api/priorities/from-task/:workItemId. Surfaces the "from task"
   * lineage on the card so users know the priority is tied to a personal
   * work item; the unified My-Work feed uses this to suppress the work
   * item from the tasks pane (it's now represented by the priority).
   */
  linkedTaskId: number | null;
  linkedTaskType: string | null;
  /**
   * Soft-delete timestamp. NULL = live; non-null = archived. Admins
   * with `?include_archived=true` may receive archived rows; everyone
   * else gets 404 on the detail and exclusion from the list.
   */
  deletedAt?: string | null;
  /** Review cadence (days). NULL = no cadence. See migration 0072. */
  reviewCadenceDays?: number | null;
  lastReviewedAt?: string | null;
  lastReviewedByUserId?: number | null;
  /** Derived: true when (lastReviewedAt ?? createdAt) + cadence < now. */
  dueForReview?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PriorityRolledUpMetrics {
  projectCount: number;
  directProjectCount: number;
  descendantPriorityCount: number;
  opportunityCount?: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  avgProgress: number;
  atRiskProjectCount: number;
  blockerCount: number;
  openTaskCount: number;
  staleOpportunityCount?: number;
  openPdTicketCount?: number;
}

export interface LinkedProject {
  id: number;
  name: string;
  phase: string | null;
  ragStatus: string | null;
  pm: PriorityUserRef | null;
  percentComplete: number;
  linkedAt: string;
  linkedDirectly: boolean;
  linkedViaPriorityId?: number;
  totalRevenue: number;
  totalCos: number;
  grossProfit: number;
  grossMarginPct: number;
  revenueRealised: number;
  cosRealised: number;
}

export interface LinkedOpportunity {
  id: number;
  dealName: string | null;
  stage: string | null;
  estimatedValue: string | null;
  expectedCloseDate: string | null;
  pipedriveStageChangedAt: string | null;
  linkedAt: string;
}

export interface PriorityDetail extends PriorityRow {
  linkedProjects?: LinkedProject[];
  linkedOpportunities?: LinkedOpportunity[];
  descendantPriorityCount?: number;
  hasDescendants?: boolean;
  directProjectCount?: number;
  rolledUp?: PriorityRolledUpMetrics;
}

export interface PriorityActivityRow {
  id: number | string;
  priorityId: number;
  actorUserId: number | null;
  actorName: string | null;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  fromName: string | null;
  toName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string | null;
  source?: "priority" | "project";
}
