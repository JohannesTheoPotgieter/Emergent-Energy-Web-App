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
