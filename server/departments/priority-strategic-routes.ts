import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requirePriorityAdmin, requirePriorityCreator } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { canPriorityRoleEditPriority, canPriorityRoleEscalatePriority, isDepartmentHeadRole, isPriorityAdminRole, isPriorityParentAllowed, isPriorityTerminalStatus } from "@shared/config/priorities";
import { getEffectiveUser } from "../auth-context";
import { db, getDbMode } from "../db";
import {
  mytoolCompanyPriorities,
  priorityProjects,
  priorityOpportunities,
  priorityComments,
  priorityWatches,
  users,
  projectInfo,
  projectExecutionState,
  derivedProjectKpis,
  workItems,
  workItemAssignments,
  workItemStatusHistory,
  approvals,
  opportunities,
  engineeringTickets,
  raidItems,
  notifications,
  priorityTemplates,
} from "@shared/schema";
import { ROLE_DEPARTMENT_MAP } from "@shared/schema/users";
import { eq, and, or, sql, desc, asc, inArray, isNull, isNotNull } from "drizzle-orm";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validateBody";
import { ApiError, badRequest, forbidden, notFound } from "../lib/api-error";
import { PRIORITY_HEALTH_VALUES, type PriorityHealth, computeEffectivePriorityHealth } from "@shared/kpi-definitions";
import { PRIORITY_SCOPES, ESCALATION_REASONS, computeEscalatePatch, collectDescendantIds, collectAncestorIds, matchesPriorityListFilter, type PriorityScope, type EscalationReason } from "@shared/config/priorities";
import { recordActivity, computeUpdateActivities, type PriorityActivityAction } from "./priority-activity-log";
import { runInTransaction } from "../lib/drizzle-helpers";
import { computePriorityProgress } from "../lib/priorities/progress-source";
import { chooseProgressPercent, toDisplayProgressPercent } from "../lib/priorities/progress-percent";
import { attachProjectScope, getProjectScope } from "../middleware/project-scope-middleware";
import { isProjectAccessible } from "../services/project-access-service";
import { getProjectListSummaries } from "../services/project-platform-summary-service";
import { priorityActivity } from "@shared/schema";

const router = Router();

// ==================== HELPERS ====================

const COO_ONLY_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

// Note: the mytool_priority_status enum only defines these terminal values:
// 'closed' and 'complete'. The previous list also included 'completed',
// 'cancelled', 'canceled' — none of which exist in the enum — which caused
// Postgres to abort with "invalid input value for enum mytool_priority_status"
// the moment any query that used these helpers ran. Keep the list aligned
// with the enum definition in shared/schema/mytool.ts.
function activePriorityStatusCondition() {
  return sql`${mytoolCompanyPriorities.status} NOT IN ('closed', 'complete')`;
}

function activePriorityStatusSql(columnName = "status") {
  return sql.raw(`${columnName} NOT IN ('closed', 'complete')`);
}

/**
 * Default predicate hiding soft-deleted priorities. Applied to every
 * list/detail read unless the caller opted in via include_archived=true
 * AND has admin role. See migration 0069.
 */
function notDeletedCondition() {
  return isNull(mytoolCompanyPriorities.deletedAt);
}

function notDeletedSql(columnName = "deleted_at") {
  return sql.raw(`${columnName} IS NULL`);
}

function getDepartmentForRole(role: string | null | undefined): string | undefined {
  return role ? (ROLE_DEPARTMENT_MAP as Record<string, string>)[role] : undefined;
}

/**
 * Notify every watcher (plus owner / assignee / accountable exec) about
 * a priority event. Best-effort: a failed insert never breaks the
 * triggering mutation. De-dupes recipients, skips the actor (don't
 * notify yourself), drops the linked_task_id slot of `notifications`
 * to point at the priority id so the existing notifications panel can
 * deep-link straight to /priority/:id.
 *
 * Wired into: single + bulk escalate, close, reopen, archive, restore.
 * Not wired into edit/comment/watch — those would be spammy.
 */
async function fanoutPriorityNotifications(opts: {
  priorityId: number;
  priority: { ownerUserId?: number | null; assignedUserId?: number | null; accountableExecId?: number | null; title?: string | null };
  actorUserId: number | null | undefined;
  eventType: string;
  title: string;
  body?: string;
}): Promise<void> {
  try {
    const watchers = await db
      .select({ userId: priorityWatches.userId })
      .from(priorityWatches)
      .where(eq(priorityWatches.priorityId, opts.priorityId));
    const recipients = new Set<number>();
    for (const w of watchers) if (typeof w.userId === "number") recipients.add(w.userId);
    if (opts.priority.ownerUserId) recipients.add(opts.priority.ownerUserId);
    if (opts.priority.assignedUserId) recipients.add(opts.priority.assignedUserId);
    if (opts.priority.accountableExecId) recipients.add(opts.priority.accountableExecId);
    if (opts.actorUserId) recipients.delete(opts.actorUserId);
    if (recipients.size === 0) return;
    await db.insert(notifications).values(
      Array.from(recipients).map((userId) => ({
        recipientUserId: userId,
        eventType: opts.eventType,
        title: opts.title,
        body: opts.body ?? null,
        linkedTaskId: opts.priorityId,
        changeDetails: JSON.stringify({ priorityId: opts.priorityId, priorityTitle: opts.priority.title ?? null }),
      })),
    );
  } catch (err: any) {
    console.warn("[Priorities] watch fan-out failed:", err?.message || err);
  }
}

/**
 * Drizzle's better-sqlite3 driver returns a TEXT timestamp column as a
 * `new Date(text)` object even when the text is an ISO string the JS
 * Date constructor accepts. When the value is NULL, it returns a JS
 * `new Date(null)` which evaluates to "Invalid Date" but is still
 * `typeof object` — so a `?? null` fallback won't catch it. Normalize
 * any timestamp-shaped field through this helper before serialising.
 */
function normalizeTimestamp(value: any): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? value.toISOString() : null;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return null;
}

function nullableNumber(value: number | null | undefined): number | null {
  return value ?? null;
}

function assertRegularPriorityUpdateFields(body: Record<string, any>, existing: any) {
  const protectedChanges: string[] = [];
  const existingScope = (existing.scope ?? "company") as PriorityScope;
  const existingDepartmentKey = existing.departmentKey ?? null;
  const existingParentId = existing.parentId ?? null;
  const existingOwnerUserId = existing.ownerUserId ?? null;
  const existingAssignedUserId = existing.assignedUserId ?? null;
  const existingAccountableExecId = existing.accountableExecId ?? null;

  if (body.scope !== undefined && body.scope !== existingScope) protectedChanges.push("scope");
  if (body.department_key !== undefined && (body.department_key ?? null) !== existingDepartmentKey) protectedChanges.push("department_key");
  if (body.parent_id !== undefined && nullableNumber(body.parent_id) !== existingParentId) protectedChanges.push("parent_id");
  if (body.owner_user_id !== undefined && nullableNumber(body.owner_user_id) !== existingOwnerUserId) protectedChanges.push("owner_user_id");
  if (body.assigned_user_id !== undefined && nullableNumber(body.assigned_user_id) !== existingAssignedUserId) protectedChanges.push("assigned_user_id");
  if (body.accountable_exec_id !== undefined && nullableNumber(body.accountable_exec_id) !== existingAccountableExecId) protectedChanges.push("accountable_exec_id");
  if (body.project_ids !== undefined) protectedChanges.push("project_ids");
  if (body.progress_source_type !== undefined || body.progress_source_ref !== undefined) protectedChanges.push("progress_source");

  if (protectedChanges.length > 0) {
    throw forbidden(`Regular users can only update personal priority fields: ${protectedChanges.join(", ")}`);
  }
}

async function assertPriorityParentLink({
  childId,
  scope,
  departmentKey,
  parentId,
}: {
  childId: number | null;
  scope: PriorityScope;
  departmentKey: string | null;
  parentId: number | null;
}) {
  if (!parentId) return;
  if (childId && parentId === childId) {
    throw badRequest("A priority cannot be its own parent");
  }

  const [parent] = await db
    .select({
      id: mytoolCompanyPriorities.id,
      scope: mytoolCompanyPriorities.scope,
      departmentKey: mytoolCompanyPriorities.departmentKey,
    })
    .from(mytoolCompanyPriorities)
    .where(eq(mytoolCompanyPriorities.id, parentId))
    .limit(1);
  if (!parent) throw badRequest("parent_id not found");

  if (!isPriorityParentAllowed({ scope, departmentKey }, parent)) {
    throw badRequest("parent_id is not valid for this priority scope and department");
  }

  if (childId) {
    const adjacency = await db
      .select({ id: mytoolCompanyPriorities.id, parentId: mytoolCompanyPriorities.parentId })
      .from(mytoolCompanyPriorities);
    const descendantIds = collectDescendantIds(
      adjacency.map((row: { id: number; parentId: number | null }) => ({
        id: row.id,
        parentId: row.parentId,
      })),
      childId,
    );
    if (descendantIds.includes(parentId)) {
      throw badRequest("A priority cannot be linked under one of its descendants");
    }
  }
}

function getRouteParamAsString(param: string | string[] | undefined): string | null {
  if (typeof param === "string") return param;
  if (Array.isArray(param) && param.length > 0) return param[0] ?? null;
  return null;
}

function parseIdParam(param: string | string[] | undefined): number | null {
  const value = getRouteParamAsString(param);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function requireCooOnly(req: Request, _res: Response, next: NextFunction) {
  const role = getEffectiveUser(req)?.role;
  if (role && COO_ONLY_ROLES.includes(role)) return next();
  next(forbidden("COO access required"));
}

// ==================== ZOD SCHEMAS ====================

const severityEnum = z.enum(["critical", "important", "normal"]);
const scopeEnum = z.enum(["company", "department", "role"]);
const healthEnum = z.enum([...(PRIORITY_HEALTH_VALUES as readonly string[])] as [string, ...string[]]);
const statusEnum = z.enum(["active", "monitoring", "closed", "not_started", "in_progress", "complete"]);
const horizonEnum = z.enum(["today", "week", "month", "quarter"]);
const reasonEnum = z.enum([...ESCALATION_REASONS] as [string, ...string[]]);

const basePrioritySchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  description: z.string().max(5000).nullable().optional(),
  severity: severityEnum.optional(),
  department: z.string().max(120).nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  accountable_exec_id: z.number().int().positive().nullable().optional(),
  target_start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  target_outcome: z.string().max(5000).nullable().optional(),
  sort_order: z.number().int().optional(),
  manual_health: healthEnum.nullable().optional(),
  manual_progress: z.number().int().min(0).max(100).nullable().optional(),
  project_ids: z.array(z.number().int().positive()).max(500).optional(),
  owner_role: z.string().max(120).nullable().optional(),
  assigned_to: z.string().max(120).nullable().optional(),
  horizon: horizonEnum.optional(),
  next_action: z.string().max(5000).nullable().optional(),
  definition_of_done: z.string().max(5000).nullable().optional(),
  support: z.array(z.string().max(120)).max(20).nullable().optional(),
  scope: scopeEnum.optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  department_key: z.string().max(120).nullable().optional(),
  assigned_user_id: z.number().int().positive().nullable().optional(),
  progress_source_type: z.enum(["manual", "project_phase", "project_percent", "milestone_revenue", "tasks_rollup"]).nullable().optional(),
  progress_source_ref: z.object({
    projectId: z.number().int().positive().optional(),
    phaseCode: z.string().max(80).optional(),
    milestoneId: z.number().int().positive().optional(),
    workItemIds: z.array(z.number().int().positive()).max(200).optional(),
  }).nullable().optional(),
});

/**
 * Semantic refinement for progress_source_type ↔ progress_source_ref.
 * Run as a `.superRefine` step on top of both create and update schemas,
 * since z.partial() can't be called on the output of superRefine.
 * Without this, a payload like
 *   { progress_source_type: "milestone_revenue", progress_source_ref: { workItemIds: [...] } }
 * saves cleanly and the compute function silently returns 0% forever
 * (see server/lib/priorities/progress-source.ts).
 */
function refineProgressSource(
  data: { progress_source_type?: string | null; progress_source_ref?: any },
  ctx: z.RefinementCtx,
) {
  const type = data.progress_source_type;
  const ref = data.progress_source_ref;
  if (!type || type === "manual") return;
  if (!ref) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["progress_source_ref"],
      message: `progress_source_ref is required when progress_source_type='${type}'`,
    });
    return;
  }
  if ((type === "project_phase" || type === "project_percent") && !ref.projectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["progress_source_ref", "projectId"],
      message: `projectId is required when progress_source_type='${type}'`,
    });
  }
  if (type === "project_phase" && !ref.phaseCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["progress_source_ref", "phaseCode"],
      message: "phaseCode is required when progress_source_type='project_phase'",
    });
  }
  if (type === "milestone_revenue" && !ref.milestoneId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["progress_source_ref", "milestoneId"],
      message: "milestoneId is required when progress_source_type='milestone_revenue'",
    });
  }
  if (type === "tasks_rollup" && (!ref.workItemIds || ref.workItemIds.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["progress_source_ref", "workItemIds"],
      message: "workItemIds (non-empty array) is required when progress_source_type='tasks_rollup'",
    });
  }
}

const createPrioritySchema = basePrioritySchema.superRefine(refineProgressSource);

const updatePrioritySchema = basePrioritySchema
  .partial()
  .extend({
    status: statusEnum.optional(),
    priority_rank: z.number().int().nullable().optional(),
  })
  .superRefine(refineProgressSource);

// Bulk action payloads. ids capped at 100 per call to keep one request
// bounded and prevent a runaway client from locking the priorities
// table for too long.
const bulkIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});
const bulkCloseSchema = bulkIdsSchema.extend({
  status: z.enum(["closed", "complete"]).default("closed"),
});
const bulkEscalateSchema = bulkIdsSchema.extend({
  reason: z.enum(["overdue", "critical", "blocked", "manual"]).default("manual"),
  note: z.string().max(1000).optional(),
});
const bulkAssignSchema = bulkIdsSchema.extend({
  assigned_user_id: z.number().int().positive().nullable(),
});

const escalatePrioritySchema = z.object({
  reason: reasonEnum.optional(),
  note: z.string().max(1000).optional(),
});

const linkProjectsSchema = z.object({
  project_ids: z.array(z.number().int().positive()).min(1, "project_ids array is required").max(500),
});

const linkOpportunitiesSchema = z.object({
  opportunity_ids: z.array(z.number().int().positive()).min(1, "opportunity_ids array is required").max(500),
});

const breakDownSchema = z.object({
  children: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    severity: severityEnum.optional(),
    department: z.string().max(120).nullable().optional(),
    due_date: z.string().nullable().optional(),
    department_key: z.string().max(120).nullable().optional(),
    assigned_user_id: z.number().int().positive().nullable().optional(),
    owner_user_id: z.number().int().positive().nullable().optional(),
  })).min(1, "children array is required").max(50),
});

interface PriorityWithMetrics {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  severity: string;
  status: string;
  dueDate: string | null;
  assignedTo: string | null;
  ownerRole: string | null;
  sortOrder: number;
  manualHealth: string | null;
  manualProgress: number | null;
  targetStartDate: string | null;
  targetOutcome: string | null;
  accountableExecId: number | null;
  ownerUserId: number | null;
  priorityRank: number | null;
  horizon: string;
  // Cascade fields
  scope: PriorityScope;
  parentId: number | null;
  departmentKey: string | null;
  assignedUserId: number | null;
  escalated: boolean;
  escalatedAt: Date | null;
  escalationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Derived
  owner: { id: number; name: string } | null;
  accountableExec: { id: number; name: string } | null;
  assignedUser: { id: number; name: string } | null;
  effectiveHealth: PriorityHealth;
  effectiveProgress: number;
  progressSource: { type: string; ref: any; value: number | null; label: string } | null;
  healthReasons: string[];
  projectCount: number;
  atRiskProjectCount: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  blockerCount: number;
  openTaskCount: number;
  engBlockerCount: number;
  qualityDefectCount: number;
  hseIncidentCount: number;
  hseCriticalCount: number;
  opportunityCount: number;
  staleOpportunityCount: number;
  openPdTicketCount: number;
  hasProjects: boolean;
  childCount: number;
  parentTitle: string | null;
}

interface DerivedMetricsRow {
  priority_id: number;
  project_count: number;
  at_risk_project_count: number;
  derived_health: PriorityHealth | null;
  total_revenue: number;
  total_cos: number;
  total_gp: number;
  avg_progress: number;
  blocker_count: number;
  open_task_count: number;
  /** Tier 4 · PR 3 cross-department signals. */
  eng_blocker_count?: number;
  quality_defect_count?: number;
  hse_incident_count?: number;
  hse_critical_count?: number;
  /** Tier 4 · PR 2 project-development signals. */
  opportunity_count?: number;
  stale_opportunity_count?: number;
  open_pd_ticket_count?: number;
}

interface PriorityLiveProgressRow {
  avgProgress: number | null;
  projectCountWithTasks: number;
}

async function getPriorityDerivedMetrics(priorityId: number): Promise<DerivedMetricsRow | null> {
  try {
    const rows: any = await db.execute(sql`
      SELECT * FROM priority_derived_metrics WHERE priority_id = ${priorityId}
    `);
    return (rows.rows?.[0] || rows[0] || null) as DerivedMetricsRow | null;
  } catch (err: any) {
    // View may not exist yet if migration hasn't run
    console.warn("[Priorities] priority_derived_metrics query failed:", err.message);
    return null;
  }
}

async function getAllPriorityDerivedMetrics(): Promise<DerivedMetricsRow[]> {
  try {
    const rows: any = await db.execute(sql`SELECT * FROM priority_derived_metrics`);
    return (rows.rows || rows) as DerivedMetricsRow[];
  } catch (err: any) {
    // View may not exist yet if migration hasn't run
    console.warn("[Priorities] priority_derived_metrics query failed:", err.message);
    return [];
  }
}

async function getPriorityLiveProgressMap(priorityIds: number[]): Promise<Map<number, PriorityLiveProgressRow>> {
  const ids = Array.from(new Set(priorityIds.filter((id) => Number.isFinite(id) && id > 0)));
  const out = new Map<number, PriorityLiveProgressRow>();
  if (ids.length === 0) return out;

  try {
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const rows: any = await db.execute(sql`
      SELECT
        pp.priority_id,
        wi.project_id,
        AVG(COALESCE(pm.percent_complete, wi.percent_complete, 0)) AS avg_pct,
        COUNT(wi.id) AS task_count
      FROM priority_projects pp
      JOIN work_items wi ON wi.project_id = pp.project_id AND wi.deleted_at IS NULL
      LEFT JOIN work_item_pm pm ON pm.work_item_id = wi.id
      WHERE pp.priority_id IN (${idList})
      GROUP BY pp.priority_id, wi.project_id
    `);

    const grouped = new Map<number, { totalPct: number; projectCount: number }>();
    for (const row of rows.rows || rows || []) {
      const priorityId = Number(row.priority_id);
      const taskCount = Number(row.task_count || 0);
      if (!Number.isFinite(priorityId) || taskCount <= 0) continue;
      const pct = toDisplayProgressPercent(row.avg_pct);
      if (pct === null) continue;
      const existing = grouped.get(priorityId) || { totalPct: 0, projectCount: 0 };
      existing.totalPct += pct;
      existing.projectCount += 1;
      grouped.set(priorityId, existing);
    }

    for (const [priorityId, value] of grouped) {
      out.set(priorityId, {
        avgProgress: value.projectCount > 0 ? Math.round(value.totalPct / value.projectCount) : null,
        projectCountWithTasks: value.projectCount,
      });
    }
  } catch (err: any) {
    console.warn("[Priorities] live progress aggregation failed:", err?.message);
  }

  return out;
}

async function getUserById(userId: number): Promise<{ id: number; name: string } | null> {
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return user || null;
}

async function getUsersByIds(userIds: number[]): Promise<Map<number, { id: number; name: string }>> {
  if (userIds.length === 0) return new Map();
  const rows: Array<{ id: number; name: string }> = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
  return new Map(rows.map((u) => [u.id, u]));
}

interface RolledUpScope {
  descendantPriorityIds: number[];
  directProjectIds: number[];
  rolledUpProjectIds: number[];
}

/**
 * Resolves the full set of project IDs that should roll up into a priority's
 * drill-down: its directly-linked projects PLUS every project linked to any
 * descendant priority. Closed descendants are excluded. Project IDs are
 * deduped so a project linked at both parent and child level is counted once.
 */
async function resolveRolledUpScope(rootPriorityId: number): Promise<RolledUpScope> {
  // Load the full adjacency of active priorities once, then let the pure
  // helper walk it. Cheap on realistic data sizes (thousands) and avoids
  // repeated per-level round trips.
  const adjacency = await db
    .select({ id: mytoolCompanyPriorities.id, parentId: mytoolCompanyPriorities.parentId })
    .from(mytoolCompanyPriorities)
    .where(activePriorityStatusCondition());

  const descendantPriorityIds = collectDescendantIds(
    adjacency.map((r: { id: number; parentId: number | null }) => ({ id: r.id, parentId: r.parentId })),
    rootPriorityId,
  );
  const allPriorityIds = [rootPriorityId, ...descendantPriorityIds];

  const directLinks: Array<{ projectId: number }> = await db
    .select({ projectId: priorityProjects.projectId })
    .from(priorityProjects)
    .where(eq(priorityProjects.priorityId, rootPriorityId));
  const directProjectIds: number[] = Array.from(new Set(directLinks.map((l) => l.projectId)));

  const allLinks: Array<{ projectId: number }> = await db
    .select({ projectId: priorityProjects.projectId })
    .from(priorityProjects)
    .where(inArray(priorityProjects.priorityId, allPriorityIds));
  const rolledUpProjectIds: number[] = Array.from(new Set(allLinks.map((l) => l.projectId)));

  return { descendantPriorityIds, directProjectIds, rolledUpProjectIds };
}

async function enrichPriority(
  priority: any,
  metrics: DerivedMetricsRow | null,
  userMap?: Map<number, { id: number; name: string }>,
  parentMap?: Map<number, string>,
  childCountMap?: Map<number, number>,
  liveProgress?: PriorityLiveProgressRow | null,
): Promise<PriorityWithMetrics> {
  // Handle both camelCase (drizzle ORM) and snake_case (raw SQL) column names
  const p = {
    id: priority.id,
    title: priority.title,
    description: priority.description,
    department: priority.department,
    severity: priority.severity,
    status: priority.status,
    dueDate: priority.dueDate ?? priority.due_date,
    assignedTo: priority.assignedTo ?? priority.assigned_to,
    ownerRole: priority.ownerRole ?? priority.owner_role,
    sortOrder: priority.sortOrder ?? priority.sort_order ?? 0,
    manualHealth: priority.manualHealth ?? priority.manual_health,
    manualProgress: priority.manualProgress ?? priority.manual_progress,
    progressSourceType: priority.progressSourceType ?? priority.progress_source_type ?? null,
    progressSourceRef: priority.progressSourceRef ?? priority.progress_source_ref ?? null,
    targetStartDate: priority.targetStartDate ?? priority.target_start_date,
    targetOutcome: priority.targetOutcome ?? priority.target_outcome,
    accountableExecId: priority.accountableExecId ?? priority.accountable_exec_id,
    ownerUserId: priority.ownerUserId ?? priority.owner_user_id,
    priorityRank: priority.priorityRank ?? priority.priority_rank,
    horizon: priority.horizon,
    nextAction: priority.nextAction ?? priority.next_action ?? null,
    definitionOfDone: priority.definitionOfDone ?? priority.definition_of_done ?? null,
    support: priority.support ?? null,
    // Cascade fields
    scope: (priority.scope ?? 'company') as PriorityScope,
    parentId: priority.parentId ?? priority.parent_id ?? null,
    departmentKey: priority.departmentKey ?? priority.department_key ?? null,
    assignedUserId: priority.assignedUserId ?? priority.assigned_user_id ?? null,
    escalated: priority.escalated ?? false,
    escalatedAt: priority.escalatedAt ?? priority.escalated_at ?? null,
    escalationReason: priority.escalationReason ?? priority.escalation_reason ?? null,
    deletedAt: normalizeTimestamp(priority.deletedAt ?? priority.deleted_at),
    createdAt: priority.createdAt ?? priority.created_at,
    updatedAt: priority.updatedAt ?? priority.updated_at,
  };

  const projectCount = Number(metrics?.project_count || 0);
  const hasProjects = projectCount > 0;
  const resolvedLiveProgress =
    liveProgress ?? (hasProjects ? ((await getPriorityLiveProgressMap([p.id])).get(p.id) ?? null) : null);
  const blockerCount = Number(metrics?.blocker_count || 0);
  const engBlockerCount = Number(metrics?.eng_blocker_count || 0);
  const qualityDefectCount = Number(metrics?.quality_defect_count || 0);
  const hseIncidentCount = Number(metrics?.hse_incident_count || 0);
  const hseCriticalCount = Number(metrics?.hse_critical_count || 0);
  const opportunityCount = Number(metrics?.opportunity_count || 0);
  const staleOpportunityCount = Number(metrics?.stale_opportunity_count || 0);
  const openPdTicketCount = Number(metrics?.open_pd_ticket_count || 0);

  const derivedHealth = hasProjects ? (metrics?.derived_health ?? null) : null;
  const manualHealth = (p.manualHealth as PriorityHealth | null) || null;

  const { health: effectiveHealth, reasons: healthReasons } = computeEffectivePriorityHealth({
    manualHealth,
    derivedHealth,
    severity: p.severity,
    dueDate: p.dueDate,
    status: p.status,
    blockerCount,
    engBlockerCount,
    qualityDefectCount,
    hseIncidentCount,
    hseCriticalCount,
    staleOpportunityCount,
    openPdTicketCount,
  });

  // Linked progress source (project_phase / project_percent / milestone_revenue
  // / tasks_rollup) takes precedence over both metrics-derived and manual.
  let progressSource: PriorityWithMetrics["progressSource"] = null;
  let linkedProgress: number | null = null;
  if (p.progressSourceType && p.progressSourceType !== "manual") {
    const computed = await computePriorityProgress(p.progressSourceType, p.progressSourceRef);
    if (computed.value != null) {
      linkedProgress = computed.value;
      progressSource = {
        type: p.progressSourceType,
        ref: p.progressSourceRef,
        value: computed.value,
        label: computed.label,
      };
    }
  }

  const projectProgress = chooseProgressPercent({
    cachedPct: metrics?.avg_progress ?? null,
    liveAvgPct: resolvedLiveProgress?.avgProgress ?? null,
    liveTaskCount: resolvedLiveProgress?.projectCountWithTasks ?? 0,
  });

  const effectiveProgress = linkedProgress != null
    ? linkedProgress
    : hasProjects
      ? (projectProgress.value ?? 0)
      : (p.manualProgress || 0);

  const owner = p.ownerUserId ? (userMap?.get(p.ownerUserId) || await getUserById(p.ownerUserId)) : null;
  const accountableExec = p.accountableExecId ? (userMap?.get(p.accountableExecId) || await getUserById(p.accountableExecId)) : null;
  const assignedUser = p.assignedUserId ? (userMap?.get(p.assignedUserId) || await getUserById(p.assignedUserId)) : null;

  return {
    ...p,
    owner,
    accountableExec,
    assignedUser,
    effectiveHealth,
    effectiveProgress,
    progressSource,
    healthReasons,
    projectCount,
    atRiskProjectCount: Number(metrics?.at_risk_project_count || 0),
    totalRevenue: Number(metrics?.total_revenue || 0),
    totalCos: Number(metrics?.total_cos || 0),
    totalGp: Number(metrics?.total_gp || 0),
    blockerCount,
    openTaskCount: Number(metrics?.open_task_count || 0),
    engBlockerCount,
    qualityDefectCount,
    hseIncidentCount,
    hseCriticalCount,
    opportunityCount,
    staleOpportunityCount,
    openPdTicketCount,
    hasProjects,
    childCount: childCountMap?.get(p.id) ?? 0,
    parentTitle: p.parentId ? (parentMap?.get(p.parentId) ?? null) : null,
  };
}

// ==================== GET /api/priorities ====================
// Supports query params: ?scope=company|department|role
//                        &department=ENGINEERING
//                        &assigned_user_id=123
//                        &parent_id=45
//                        &include_cancelled=true
//                        &escalated_only=true
//                        &include_team_roles=true  (dept tab: include team's role priorities)
router.get("/api/priorities", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const includeCancelled = req.query.include_cancelled === "true";
  // Archived (soft-deleted) priorities are hidden by default. Only
  // priority admins may opt in via include_archived=true.
  const callerRole = getEffectiveUser(req)?.role;
  const includeArchived = req.query.include_archived === "true" && isPriorityAdminRole(callerRole);
  const rawScope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  const scopeFilter: PriorityScope | null =
    rawScope && PRIORITY_SCOPES.includes(rawScope as PriorityScope)
      ? (rawScope as PriorityScope)
      : null;
  const departmentFilter = typeof req.query.department === "string" ? req.query.department : null;
  const assignedUserIdFilter = typeof req.query.assigned_user_id === "string" ? req.query.assigned_user_id : undefined;
  const parentIdFilter = typeof req.query.parent_id === "string" ? req.query.parent_id : undefined;
  const escalatedOnly = req.query.escalated_only === "true";
  const includeTeamRoles = req.query.include_team_roles === "true";

  // Fetch all priorities
  let allPriorities: any[];
  try {
    allPriorities = await db.select().from(mytoolCompanyPriorities);
  } catch (dbErr: any) {
    console.error("[Priorities] DB query failed:", dbErr.message);
    const raw: any = await db.execute(sql`SELECT * FROM mytool_company_priorities ORDER BY id`);
    allPriorities = raw.rows || raw || [];
  }

  // Hide soft-deleted (archived) priorities unless explicitly requested.
  // (normalizeTimestamp handles better-sqlite3's Invalid-Date object.)
  if (!includeArchived) {
    allPriorities = allPriorities.filter((p: any) => normalizeTimestamp(p.deletedAt ?? p.deleted_at) == null);
  }

  // Filter out cancelled unless requested
  if (!includeCancelled) {
    allPriorities = allPriorities.filter((p: any) => !isPriorityTerminalStatus(p.status));
  }

  // Department-head team-role inclusion: when the dept tab asks for
  // include_team_roles=true, also surface role-scoped priorities owned or
  // assigned to team members whose role maps to the target department via
  // ROLE_DEPARTMENT_MAP. Keeps the existing department-scope + department_key
  // match as the primary path.
  let teamUserIds: Set<number> = new Set();
  if (includeTeamRoles && scopeFilter === "department" && departmentFilter) {
    const teamUsers: Array<{ id: number; role: string | null }> = await db
      .select({ id: users.id, role: users.role })
      .from(users);
    teamUserIds = new Set(
      teamUsers
        .filter((u) => u.role && (ROLE_DEPARTMENT_MAP as Record<string, string>)[u.role] === departmentFilter)
        .map((u) => u.id),
    );
  }

  // Apply scope + department + team-role filter via the shared pure matcher.
  allPriorities = allPriorities.filter((p: any) =>
    matchesPriorityListFilter(
      {
        scope: (p.scope ?? "company") as PriorityScope,
        departmentKey: p.departmentKey ?? p.department_key ?? null,
        ownerUserId: p.ownerUserId ?? p.owner_user_id ?? null,
        assignedUserId: p.assignedUserId ?? p.assigned_user_id ?? null,
      },
      { scopeFilter, departmentFilter, teamUserIds },
    ),
  );

  // Apply assigned user filter — 'me' resolves to the current user
  if (assignedUserIdFilter) {
    const targetUserId = assignedUserIdFilter === "me"
      ? getEffectiveUser(req)?.id
      : parseInt(assignedUserIdFilter, 10);
    if (targetUserId) {
      allPriorities = allPriorities.filter((p: any) =>
        (p.assignedUserId ?? p.assigned_user_id) === targetUserId
        || (p.ownerUserId ?? p.owner_user_id) === targetUserId
      );
    }
  }

  // Apply parent filter
  if (parentIdFilter) {
    const parentId = parseInt(parentIdFilter, 10);
    if (!Number.isNaN(parentId)) {
      allPriorities = allPriorities.filter((p: any) => (p.parentId ?? p.parent_id) === parentId);
    }
  }

  // Apply escalation filter
  if (escalatedOnly) {
    allPriorities = allPriorities.filter((p: any) => p.escalated === true);
  }

    // Get all derived metrics
    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));
    const liveProgressMap = await getPriorityLiveProgressMap(allPriorities.map((p: any) => Number(p.id)));

    // Prefetch referenced users to avoid N+1 lookups
    const userIds = Array.from(new Set(
      allPriorities.flatMap((p: any) => [
        p.ownerUserId ?? p.owner_user_id,
        p.accountableExecId ?? p.accountable_exec_id,
        p.assignedUserId ?? p.assigned_user_id,
      ].filter(Boolean)),
    )) as number[];
    const userMap = await getUsersByIds(userIds);

    // Build child count map (how many children does each priority have)
    const childCountResult: any = getDbMode() === "sqlite"
      ? await db.execute(sql`
        SELECT parent_id, COUNT(*) AS child_count
        FROM mytool_company_priorities
        WHERE parent_id IS NOT NULL AND ${activePriorityStatusSql()}
        GROUP BY parent_id
      `)
      : await db.execute(sql`
        SELECT parent_id, COUNT(*)::int AS child_count
        FROM mytool_company_priorities
        WHERE parent_id IS NOT NULL AND ${activePriorityStatusSql()}
        GROUP BY parent_id
      `);
    const childCountMap = new Map<number, number>();
    for (const row of (childCountResult.rows || childCountResult || [])) {
      childCountMap.set(Number(row.parent_id), Number(row.child_count || 0));
    }

    // Build parent title map
    const parentIds = [...new Set(allPriorities.map((p: any) => p.parentId ?? p.parent_id).filter(Boolean))] as number[];
    const parentMap = new Map<number, string>();
    if (parentIds.length > 0) {
      const parents = await db
        .select({ id: mytoolCompanyPriorities.id, title: mytoolCompanyPriorities.title })
        .from(mytoolCompanyPriorities)
        .where(inArray(mytoolCompanyPriorities.id, parentIds));
      for (const p of parents) {
        parentMap.set(p.id, p.title);
      }
    }

    // Enrich with metrics
    const enriched = await Promise.all(
      allPriorities.map((p: any) => enrichPriority(
        p,
        metricsMap.get(p.id),
        userMap,
        parentMap,
        childCountMap,
        liveProgressMap.get(p.id) ?? null,
      ))
    );

    // Sort: escalated first, then severity DESC, health DESC, dueDate ASC, sortOrder ASC
    const severityOrder: Record<string, number> = { critical: 0, important: 1, normal: 2 };
    const healthOrder: Record<string, number> = { critical: 0, at_risk: 1, healthy: 2 };
    enriched.sort((a, b) => {
      // Escalated items float to top
      if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;

      const sevA = severityOrder[a.severity] ?? 2;
      const sevB = severityOrder[b.severity] ?? 2;
      if (sevA !== sevB) return sevA - sevB;

      const hA = healthOrder[a.effectiveHealth] ?? 2;
      const hB = healthOrder[b.effectiveHealth] ?? 2;
      if (hA !== hB) return hA - hB;

      // Due date ASC (nulls last)
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;

      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });

  res.json(enriched);
}));

// ==================== GET /api/priorities/my-work ====================
// Unified "what's on my plate" feed — discriminated union of:
//   • Priorities the caller owns or is assigned to (any scope)
//   • Active work_items the caller owns or is assigned via
//     work_item_assignments
// Work items already linked from a priority (linkedTaskId) are suppressed
// so the same item never shows up twice. Closed/cancelled/completed work
// items are hidden unless include_closed=true. Priorities follow the
// existing show-closed contract on the parent /api/priorities query.
//
// Phase 7A unifies the My Tasks + My Priorities surfaces under
// /priorities → My Priorities. /my-work/tasks keeps its dedicated page
// for power users this release; will fold in the next one.
router.get("/api/priorities/my-work", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  const userId = user?.id;
  if (!userId) throw badRequest("No effective user");
  const includeClosed = req.query.include_closed === "true";

  // 1) Priorities the user owns or is assigned to (across all scopes).
  let priorities: any[] = [];
  try {
    priorities = await db.select().from(mytoolCompanyPriorities);
  } catch (dbErr: any) {
    console.error("[Priorities] my-work DB query failed:", dbErr.message);
    const raw: any = await db.execute(sql`SELECT * FROM mytool_company_priorities ORDER BY id`);
    priorities = raw.rows || raw || [];
  }
  priorities = priorities.filter((p: any) => {
    // Archived priorities never appear in My Work, even for admins. The
    // admin's archive view lives behind include_archived=true on the
    // list endpoint, not the user's daily feed.
    if (normalizeTimestamp(p.deletedAt ?? p.deleted_at) != null) return false;
    const owner = p.ownerUserId ?? p.owner_user_id ?? null;
    const assigned = p.assignedUserId ?? p.assigned_user_id ?? null;
    if (owner !== userId && assigned !== userId) return false;
    if (!includeClosed && isPriorityTerminalStatus(p.status)) return false;
    return true;
  });

  const allMetrics = await getAllPriorityDerivedMetrics();
  const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));
  const liveProgressMap = await getPriorityLiveProgressMap(priorities.map((p: any) => Number(p.id)));
  const userIds = Array.from(new Set(
    priorities.flatMap((p: any) => [
      p.ownerUserId ?? p.owner_user_id,
      p.accountableExecId ?? p.accountable_exec_id,
      p.assignedUserId ?? p.assigned_user_id,
    ].filter(Boolean)),
  )) as number[];
  const userMap = await getUsersByIds(userIds);
  const parentIds = Array.from(new Set(
    priorities.map((p: any) => p.parentId ?? p.parent_id).filter((v: number | null) => v != null),
  )) as number[];
  const parentMap = new Map<number, string>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: mytoolCompanyPriorities.id, title: mytoolCompanyPriorities.title })
      .from(mytoolCompanyPriorities)
      .where(inArray(mytoolCompanyPriorities.id, parentIds));
    for (const p of parents) parentMap.set(p.id, p.title);
  }
  const enrichedPriorities = await Promise.all(
    priorities.map((p: any) => enrichPriority(
      p,
      metricsMap.get(p.id),
      userMap,
      parentMap,
      undefined,
      liveProgressMap.get(p.id) ?? null,
    )),
  );

  // 2) Active work items owned by OR assigned to the caller.
  const ownedRows = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.ownerUserId, userId), isNull(workItems.deletedAt)));
  const assignedRows = await db
    .select({ work_items: workItems })
    .from(workItemAssignments)
    .innerJoin(workItems, eq(workItemAssignments.workItemId, workItems.id))
    .where(and(eq(workItemAssignments.userId, userId), isNull(workItems.deletedAt)));
  const taskMap = new Map<number, any>();
  for (const wi of ownedRows) taskMap.set(wi.id, wi);
  for (const row of assignedRows) {
    const wi = (row as any).work_items;
    if (wi && !taskMap.has(wi.id)) taskMap.set(wi.id, wi);
  }

  // 3) Suppress work items the CALLER has already promoted into their own
  //    priority list. Per-user scoping: if another user promoted the same
  //    shared task, the caller still sees it in their tasks pane until
  //    they promote it themselves. This matches the per-user idempotency
  //    in POST /api/priorities/from-task/:workItemId.
  const linkedIds = new Set<number>();
  const ownLinks = await db
    .select({ linkedTaskId: mytoolCompanyPriorities.linkedTaskId })
    .from(mytoolCompanyPriorities)
    .where(
      and(
        or(
          eq(mytoolCompanyPriorities.ownerUserId, userId),
          eq(mytoolCompanyPriorities.assignedUserId, userId),
        ),
        isNotNull(mytoolCompanyPriorities.linkedTaskId),
      ),
    );
  for (const row of ownLinks) {
    if (typeof row.linkedTaskId === "number") linkedIds.add(row.linkedTaskId);
  }

  // 4) Filter + normalise tasks.
  const projectLookup = new Map<number, string>();
  const projectIds = Array.from(
    new Set(Array.from(taskMap.values()).map((t: any) => t.projectId).filter((v: number | null) => v != null)),
  );
  if (projectIds.length > 0) {
    const projectRows = await db
      .select({ id: projectInfo.id, name: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds as number[]));
    for (const p of projectRows) projectLookup.set(p.id, p.name);
  }

  const TASK_CLOSED_STATUSES = new Set(["closed", "complete", "completed", "cancelled", "done"]);
  const taskRows = Array.from(taskMap.values())
    .filter((t: any) => !linkedIds.has(t.id))
    .filter((t: any) => includeClosed || !TASK_CLOSED_STATUSES.has(String(t.status || "").toLowerCase()))
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      priority: t.priority ?? null,
      dueDate: t.endDate ?? null,
      startDate: t.startDate ?? null,
      projectId: t.projectId ?? null,
      projectName: t.projectId ? (projectLookup.get(t.projectId) ?? null) : null,
      ownerUserId: t.ownerUserId ?? null,
      ownerName: t.ownerName ?? null,
      workstream: t.workstream,
      source: t.source,
      taskCategory: t.taskCategory ?? null,
      bucket: t.bucket ?? null,
      percentComplete: t.percentComplete ?? 0,
      // Phase 7C: expose the red/amber/green health signal so /priorities
      // can apply the health filter chip to tasks the same way it does
      // for priorities. `trackingRag` is canonical on work_items; we don't
      // synthesise it client-side.
      trackingRag: t.trackingRag ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

  // 5) Wire format: discriminated union, priorities first (they carry the
  //    escalation chain), tasks after. Both sorted: due-date ASC then
  //    title for deterministic output.
  const PRIORITY_BUCKET = enrichedPriorities.map((p: any) => ({ kind: "priority" as const, priority: p }));
  const TASK_BUCKET = taskRows.map((t) => ({ kind: "task" as const, task: t }));

  const dueDateAsc = (a: string | null, b: string | null): number => {
    if (a && b) return a.localeCompare(b);
    if (a) return -1;
    if (b) return 1;
    return 0;
  };
  PRIORITY_BUCKET.sort((a, b) => dueDateAsc(a.priority.dueDate, b.priority.dueDate));
  TASK_BUCKET.sort((a, b) => dueDateAsc(a.task.dueDate, b.task.dueDate));

  res.json({
    userId,
    items: [...PRIORITY_BUCKET, ...TASK_BUCKET],
    counts: {
      priorities: PRIORITY_BUCKET.length,
      tasks: TASK_BUCKET.length,
      total: PRIORITY_BUCKET.length + TASK_BUCKET.length,
    },
  });
}));

// ==================== POST /api/priorities/from-task/:workItemId ====================
// Promote an existing work_item to a *personal* (scope='role') priority.
// Creates a new mytool_company_priorities row with scope='role', copies
// title/description/dueDate from the work_item, and stores `linkedTaskId`
// so the unified feed knows to suppress the work_item next time it
// renders. Idempotent: if a priority already exists with this linkedTaskId,
// returns it instead of creating a duplicate.
//
// Authorization model (deliberately NOT `requirePermission`):
//   • requirePriorityCreator / `company_priorities:edit` gate company- and
//     department-scope priorities to admins + dept heads. A user promoting
//     their OWN task to their OWN personal priority is a different intent.
// ==================== POST /api/priorities/tasks ====================
// Create a personal work_item (no project required) from the My Priorities
// page. The existing POST /api/tasks requires projectId which personal
// tasks don't have, so this endpoint bypasses that constraint.
router.post("/api/priorities/tasks", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");

  const schema = z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    dueDate: z.string().optional(),
    priority: z.enum(["normal", "high", "critical"]).optional(),
  });
  const body = schema.parse(req.body);

  const [item] = await db.insert(workItems).values({
    title: body.title,
    description: body.description ?? null,
    endDate: body.dueDate ?? null,
    priority: body.priority ?? "normal",
    workstream: "PERSONAL",
    bucket: "personal",
    status: "Not Started",
    source: "UI",
    ownerUserId: user.id,
    createdBy: user.id,
  } as any).returning();

  await db.insert(workItemStatusHistory).values({
    workItemId: item.id,
    newStatus: "Not Started",
    changedBy: user.id,
    reason: "Personal task created from Priorities page",
  } as any);

  res.status(201).json(item);
}));

// DELETE /api/priorities/tasks/:id — soft-delete a personal work_item.
// Only the owner can delete their own task. Uses the priorities-domain
// endpoint to bypass the admin-only gate in task-management-routes.ts.
router.delete("/api/priorities/tasks/:id", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");

  const taskId = parseIdParam(req.params.id);
  if (taskId === null) throw badRequest("Invalid task id");

  const [task] = await db
    .select({ id: workItems.id, ownerUserId: workItems.ownerUserId })
    .from(workItems)
    .where(and(eq(workItems.id, taskId), isNull(workItems.deletedAt)));

  if (!task) throw notFound("Task");
  if (task.ownerUserId !== user.id) throw forbidden("You can only delete tasks you own");

  await db
    .update(workItems)
    .set({ deletedAt: new Date() } as any)
    .where(eq(workItems.id, taskId));

  res.json({ success: true });
}));

//   • Any authenticated user can promote, but only for tasks they
//     own or are assigned to (verified below against work_item_assignments).
//   • The created priority is hard-coded to scope='role' + ownerUserId =
//     caller, so this endpoint can never produce a department/company
//     priority — those still go through the gated create endpoint.
//
// This endpoint is intentionally listed in qa/fixtures/route-coverage-
// baseline.json as an authorization-by-ownership route. Route-coverage
// CI is fine with that.
router.post("/api/priorities/from-task/:workItemId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  const userId = user?.id;
  if (!userId) throw badRequest("No effective user");
  const workItemId = Number(req.params.workItemId);
  if (!Number.isInteger(workItemId) || workItemId <= 0) throw badRequest("Invalid work item id");

  // Verify the work_item exists + the caller has it on their plate (owned
  // OR assigned). Otherwise reject — no one should promote someone else's
  // task to their priority list.
  const [task] = await db.select().from(workItems).where(eq(workItems.id, workItemId));
  if (!task) throw notFound("Work item");
  const isOwner = task.ownerUserId === userId;
  let isAssigned = false;
  if (!isOwner) {
    const [assignment] = await db
      .select({ id: workItemAssignments.id })
      .from(workItemAssignments)
      .where(and(eq(workItemAssignments.workItemId, workItemId), eq(workItemAssignments.userId, userId)))
      .limit(1);
    isAssigned = !!assignment;
  }
  if (!isOwner && !isAssigned) {
    throw forbidden("You can only promote tasks you own or are assigned to.");
  }

  // Idempotency — per-user. A shared task can be promoted independently
  // by each owner/assignee into THEIR OWN role priority. Idempotency
  // therefore scopes on (linkedTaskId, ownerUserId): if the caller has
  // already promoted this task, return that row; another user's promoted
  // copy must not be returned to (or shared with) the caller.
  const [existing] = await db
    .select()
    .from(mytoolCompanyPriorities)
    .where(
      and(
        eq(mytoolCompanyPriorities.linkedTaskId, workItemId),
        eq(mytoolCompanyPriorities.ownerUserId, userId),
      ),
    )
    .limit(1);
  if (existing) {
    const metrics = await getPriorityDerivedMetrics(existing.id);
    const enriched = await enrichPriority(existing, metrics);
    return res.json({ kind: "priority", priority: enriched, alreadyExisted: true });
  }

  const dueDate = task.endDate ? String(task.endDate) : null;
  const [created] = await db
    .insert(mytoolCompanyPriorities)
    .values({
      title: task.title,
      description: task.description ?? null,
      scope: "role",
      severity: "normal",
      status: "active",
      horizon: "week",
      ownerUserId: userId,
      assignedUserId: userId,
      linkedTaskId: workItemId,
      linkedTaskType: "work_item",
      dueDate,
    })
    .returning();

  // Audit
  try {
    await recordActivity({
      priorityId: created.id,
      actorUserId: userId,
      action: "created",
      details: { source: "promoted_from_task", workItemId, taskTitle: task.title, ownerUserId: userId },
    });
  } catch (err) {
    console.warn("[Priorities] from-task: failed to record activity:", err);
  }

  const metrics = await getPriorityDerivedMetrics(created.id);
  const enriched = await enrichPriority(created, metrics);
  res.status(201).json({ kind: "priority", priority: enriched, alreadyExisted: false });
}));

router.get(
  "/api/priorities/progress-source-options",
  requireAuth,
  attachProjectScope,
  asyncHandler(getPriorityProgressSourceOptions),
);

// ==================== GET /api/priorities/:id ====================
// ==================== GET /api/priorities/search ====================
//
// MUST be registered before /api/priorities/:id, otherwise Express
// parses "search" as a priority id and returns "Invalid priority id"
// (the same trap that bit the progress-source-options route).
//
// Lightweight free-text search across title + description, filtered
// to what the caller is allowed to see, ranked by title-startswith >
// title-contains > description-contains > recency.
router.get(
  "/api/priorities/search",
  requireAuth,
  requirePermission("company_priorities", "view"),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const userDept = getDepartmentForRole(user.role);
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2) throw badRequest("Search query must be at least 2 characters");
    const scope = typeof req.query.scope === "string" && PRIORITY_SCOPES.includes(req.query.scope as PriorityScope)
      ? (req.query.scope as PriorityScope) : null;
    const includeClosed = req.query.include_closed === "true";
    const includeArchived = req.query.include_archived === "true" && isPriorityAdminRole(user.role);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 100);

    let rows: any[] = await db.select().from(mytoolCompanyPriorities);
    rows = rows.filter((p: any) => {
      if (!includeArchived && normalizeTimestamp(p.deletedAt ?? p.deleted_at) != null) return false;
      if (!includeClosed && isPriorityTerminalStatus(p.status)) return false;
      if (scope && p.scope !== scope) return false;
      if (!isPriorityAdminRole(user.role)) {
        if (isDepartmentHeadRole(user.role)) {
          if (p.scope === "company") return false;
          if (p.scope === "department" && p.departmentKey && p.departmentKey !== userDept) return false;
          if (p.scope === "role" && p.departmentKey && p.departmentKey !== userDept) return false;
        } else {
          if (p.scope === "company") return false;
          if (p.scope === "department") return false;
          if (p.scope === "role" && p.ownerUserId !== user.id && p.assignedUserId !== user.id) return false;
        }
      }
      const title = String(p.title ?? "").toLowerCase();
      const desc = String(p.description ?? "").toLowerCase();
      return title.includes(q) || desc.includes(q);
    });

    rows.sort((a: any, b: any) => {
      const aTitle = String(a.title ?? "").toLowerCase();
      const bTitle = String(b.title ?? "").toLowerCase();
      const aTitleStart = aTitle.startsWith(q) ? 0 : 1;
      const bTitleStart = bTitle.startsWith(q) ? 0 : 1;
      if (aTitleStart !== bTitleStart) return aTitleStart - bTitleStart;
      const aHasTitle = aTitle.includes(q) ? 0 : 1;
      const bHasTitle = bTitle.includes(q) ? 0 : 1;
      if (aHasTitle !== bHasTitle) return aHasTitle - bHasTitle;
      return (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0);
    });

    const top = rows.slice(0, limit);
    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));
    const enriched = await Promise.all(top.map((p: any) => enrichPriority(p, metricsMap.get(p.id))));
    res.json({ q, totalMatches: rows.length, returned: enriched.length, results: enriched });
  }),
);

// Drill-down is now a rolled-up view: `linkedProjects` includes every project
// linked to this priority OR any descendant, deduped. A `rolledUp` object
// carries the aggregated financial / progress / blocker totals across the
// same set so the UI can present the "everything open against this priority"
// single pane of glass. The direct-only numbers remain on the envelope for
// callers that still want them.
router.get("/api/priorities/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");
  const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
  if (!priority) throw notFound("Priority");
  // Archived priorities are 404 to non-admins. Admins can fetch via
  // ?include_archived=true so the restore UI can read the row.
  // (normalizeTimestamp handles better-sqlite3's "Invalid Date" oddity.)
  if (normalizeTimestamp(priority.deletedAt) != null) {
    const callerRole = getEffectiveUser(req)?.role;
    const wantArchived = req.query.include_archived === "true" && isPriorityAdminRole(callerRole);
    if (!wantArchived) throw notFound("Priority");
  }

    const metrics = await getPriorityDerivedMetrics(priorityId);
    // Direct child count for the header badge ("3 sub-priorities") on the
    // detail page. The list endpoint computes this in a single grouped
    // query; here it's a one-row lookup against the same predicate (active
    // children only — closed/complete children don't drive the badge).
    const directChildren = await db
      .select({ id: mytoolCompanyPriorities.id })
      .from(mytoolCompanyPriorities)
      .where(and(eq(mytoolCompanyPriorities.parentId, priorityId), activePriorityStatusCondition()));
    const childCountMap = new Map<number, number>([[priorityId, directChildren.length]]);
    const enriched = await enrichPriority(priority, metrics, undefined, undefined, childCountMap);

    const { descendantPriorityIds, directProjectIds, rolledUpProjectIds } = await resolveRolledUpScope(priorityId);

    // Fetch project detail for every project in the rolled-up set (direct +
    // via descendants). The link-level rows give us the linkedAt timestamp
    // and which priority each project was linked through; the foundation
    // helper (`getProjectListSummaries`) gives us the canonical view-row
    // shape with three layers of fallback (RAG: stored→derived,
    // % Complete: cache→live, Finance: cache→live) so this route doesn't
    // have to repeat that logic — see project-platform-summary-service.ts.
    const linkedRows = rolledUpProjectIds.length === 0 ? [] : await db
      .select({
        projectId: priorityProjects.projectId,
        linkedAt: priorityProjects.linkedAt,
        linkedViaPriorityId: priorityProjects.priorityId,
      })
      .from(priorityProjects)
      .where(inArray(priorityProjects.projectId, rolledUpProjectIds));

    // Dedupe by project id — a project linked at both parent and child level
    // should appear once. Prefer the row linked directly to this priority
    // when both exist (so the UI shows "direct" not "via sub-priority").
    const linkRowByProjectId = new Map<number, typeof linkedRows[number]>();
    for (const row of linkedRows) {
      const existing = linkRowByProjectId.get(row.projectId);
      if (!existing) linkRowByProjectId.set(row.projectId, row);
      else if (row.linkedViaPriorityId === priorityId) linkRowByProjectId.set(row.projectId, row);
    }

    const dedupedProjectIds = Array.from(linkRowByProjectId.keys());
    const summaryByProjectId = await getProjectListSummaries({ projectIds: dedupedProjectIds });

    const directSet = new Set(directProjectIds);
    const projectsWithPm = await Promise.all(dedupedProjectIds.map(async (pid) => {
      const link = linkRowByProjectId.get(pid)!;
      const summary = summaryByProjectId.get(pid);
      if (!summary) return null;
      const pm = summary.pmUserId ? await getUserById(summary.pmUserId) : null;
      return {
        id: summary.id,
        name: summary.name,
        phase: summary.phase,
        ragStatus: summary.ragStatus,
        ragSource: summary.ragSource,
        ragReason: summary.ragReason,
        pm: pm || (summary.pmName ? { id: 0, name: summary.pmName } : null),
        percentComplete: summary.percentComplete ?? 0,
        percentCompleteSource: summary.percentCompleteSource,
        linkedAt: link.linkedAt,
        linkedDirectly: directSet.has(pid),
        linkedViaPriorityId: link.linkedViaPriorityId,
        totalRevenue: summary.totalRevenue,
        totalCos: summary.totalCos,
        grossProfit: summary.grossProfit,
        grossMarginPct: summary.grossMarginPct,
        revenueRealised: summary.revenueRealised,
        cosRealised: summary.cosRealised,
        kpiSource: summary.kpiSource,
      };
    })).then(rows => rows.filter((r): r is NonNullable<typeof r> => r !== null));

    // Aggregate rolled-up metrics from the deduped project set.
    const rolledUpTotalRevenue = projectsWithPm.reduce((s, p) => s + p.totalRevenue, 0);
    const rolledUpTotalCos = projectsWithPm.reduce((s, p) => s + p.totalCos, 0);
    const rolledUpGrossProfit = projectsWithPm.reduce((s, p) => s + p.grossProfit, 0);
    const rolledUpAtRisk = projectsWithPm.filter(p => (p.ragStatus || "").toLowerCase() === "red").length;
    const rolledUpAvgProgress = projectsWithPm.length === 0
      ? 0
      : Math.round(projectsWithPm.reduce((s, p) => s + p.percentComplete, 0) / projectsWithPm.length);

    // Blocker + open-task counts across the rolled-up project set. Uses the
    // same filter as the priority_derived_metrics view so counts stay
    // consistent with the list-card figures.
    let rolledUpBlockerCount = 0;
    let rolledUpOpenTaskCount = 0;
    if (rolledUpProjectIds.length > 0) {
      const [blockerRow]: any = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM work_items
        WHERE project_id IN ${rolledUpProjectIds} AND deleted_at IS NULL
        AND LOWER(status) LIKE '%block%'
      `).then((r: any) => r.rows || r).catch(() => [{ n: 0 }]);
      rolledUpBlockerCount = Number(blockerRow?.n || 0);
      const [openRow]: any = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM work_items
        WHERE project_id IN ${rolledUpProjectIds} AND deleted_at IS NULL
        AND LOWER(status) NOT IN ('complete', 'completed', 'done', 'cancelled', 'canceled', 'qc approved')
      `).then((r: any) => r.rows || r).catch(() => [{ n: 0 }]);
      rolledUpOpenTaskCount = Number(openRow?.n || 0);
    }

    // Linked opportunities (Tier 4 · PR 2) — enriched with open-PD-ticket
    // count so the detail page can show pipeline health next to the deal.
    const linkedOpps = await db
      .select({
        id: opportunities.id,
        dealName: opportunities.dealName,
        stage: opportunities.stage,
        estimatedValue: opportunities.estimatedValue,
        expectedCloseDate: opportunities.expectedCloseDate,
        pipedriveStageChangedAt: opportunities.pipedriveStageChangedAt,
        linkedAt: priorityOpportunities.linkedAt,
      })
      .from(priorityOpportunities)
      .innerJoin(opportunities, eq(priorityOpportunities.opportunityId, opportunities.id))
      .where(eq(priorityOpportunities.priorityId, priorityId));

    res.json({
      ...enriched,
      linkedProjects: projectsWithPm,
      linkedOpportunities: linkedOpps,
      descendantPriorityCount: descendantPriorityIds.length,
      hasDescendants: descendantPriorityIds.length > 0,
      directProjectCount: directProjectIds.length,
      rolledUp: {
        projectCount: projectsWithPm.length,
        directProjectCount: directProjectIds.length,
        descendantPriorityCount: descendantPriorityIds.length,
        opportunityCount: linkedOpps.length,
        totalRevenue: rolledUpTotalRevenue,
        totalCos: rolledUpTotalCos,
        totalGp: rolledUpGrossProfit,
        avgProgress: rolledUpAvgProgress,
        atRiskProjectCount: rolledUpAtRisk,
        blockerCount: rolledUpBlockerCount,
        openTaskCount: rolledUpOpenTaskCount,
        staleOpportunityCount: enriched.staleOpportunityCount,
        openPdTicketCount: enriched.openPdTicketCount,
      },
    });
}));

// ==================== POST /api/priorities ====================
router.post(
  "/api/priorities",
  requireAuth,
  requirePermission("company_priorities", "view"),
  validateBody(createPrioritySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const body = req.body as z.infer<typeof createPrioritySchema>;
    const {
      title, description, severity, department, owner_user_id, accountable_exec_id,
      target_start_date, due_date, target_outcome, sort_order,
      manual_health, manual_progress, project_ids, owner_role, assigned_to,
      horizon, next_action, definition_of_done, support,
      scope, parent_id, department_key, assigned_user_id,
    } = body;

    const isPriorityAdmin = isPriorityAdminRole(user.role);
    const isDeptHead = isDepartmentHeadRole(user.role);
    const userDept = getDepartmentForRole(user.role);
    const effectiveScope = (scope || (isPriorityAdmin ? "company" : "role")) as PriorityScope;
    let effectiveDepartmentKey = department_key || null;
    let effectiveOwnerUserId = owner_user_id || null;
    let effectiveAssignedUserId = assigned_user_id || null;
    let effectiveAccountableExecId = accountable_exec_id || null;
    let effectiveParentId = parent_id || null;
    let effectiveProjectIds = project_ids || [];

    if (!isPriorityAdmin && !isDeptHead) {
      if (effectiveScope !== "role") {
        throw badRequest("Regular users can only create personal role priorities");
      }
      effectiveDepartmentKey = userDept || null;
      effectiveOwnerUserId = user.id;
      effectiveAssignedUserId = user.id;
      effectiveAccountableExecId = null;
      effectiveParentId = null;
      effectiveProjectIds = [];
    } else if (!isPriorityAdmin) {
      if (effectiveScope !== "department" && effectiveScope !== "role") {
        throw badRequest("Dept-head users can only create department or role priorities");
      }
      if (!userDept) throw badRequest("Your role has no associated department");
      if (effectiveDepartmentKey && effectiveDepartmentKey !== userDept) {
        throw badRequest("You may only create priorities for your own department");
      }
      effectiveDepartmentKey = effectiveDepartmentKey || userDept;
    }

    if (effectiveOwnerUserId) {
      const ownerUser = await getUserById(effectiveOwnerUserId);
      if (!ownerUser) throw badRequest("owner_user_id not found");
    }
    if (effectiveAccountableExecId) {
      const execUser = await getUserById(effectiveAccountableExecId);
      if (!execUser) throw badRequest("accountable_exec_id not found");
    }
    if (effectiveAssignedUserId) {
      const assignee = await getUserById(effectiveAssignedUserId);
      if (!assignee) throw badRequest("assigned_user_id not found");
    }
    await assertPriorityParentLink({
      childId: null,
      scope: effectiveScope,
      departmentKey: effectiveDepartmentKey,
      parentId: effectiveParentId,
    });
    if (effectiveProjectIds.length > 0) {
      const projectRows = await db.select({ id: projectInfo.id }).from(projectInfo).where(inArray(projectInfo.id, effectiveProjectIds));
      if (projectRows.length !== effectiveProjectIds.length) throw badRequest("One or more project_ids not found");
    }

    const now = new Date();
    const [created] = await db.insert(mytoolCompanyPriorities).values({
      title,
      description: description || null,
      severity: severity || "normal",
      department: department || null,
      ownerUserId: effectiveOwnerUserId,
      accountableExecId: effectiveAccountableExecId,
      targetStartDate: target_start_date || null,
      dueDate: due_date || null,
      targetOutcome: target_outcome || null,
      sortOrder: sort_order || 0,
      manualHealth: manual_health || null,
      manualProgress: manual_progress != null ? manual_progress : null,
      ownerRole: owner_role || null,
      assignedTo: assigned_to || null,
      horizon: horizon || "quarter",
      nextAction: next_action || null,
      definitionOfDone: definition_of_done || null,
      support: support || null,
      scope: effectiveScope,
      parentId: effectiveParentId,
      departmentKey: effectiveDepartmentKey,
      assignedUserId: effectiveAssignedUserId,
      createdAt: now,
      updatedAt: now,
    }).returning();

    if (effectiveProjectIds.length > 0) {
      await db.insert(priorityProjects).values(
        effectiveProjectIds.map((pid: number) => ({
          priorityId: created.id,
          projectId: pid,
          linkedBy: user.id,
        }))
      );
    }

    await recordActivity({
      priorityId: created.id,
      actorUserId: user.id,
      action: "created",
      toValue: created.title,
      details: {
        scope: created.scope,
        severity: created.severity,
        projectCount: effectiveProjectIds.length,
      },
    });

    const metrics = await getPriorityDerivedMetrics(created.id);
    const enriched = await enrichPriority(created, metrics);
    res.status(201).json(enriched);
  }),
);

// ==================== PUT /api/priorities/:id ====================
router.put(
  "/api/priorities/:id",
  requireAuth,
  requirePermission("company_priorities", "view"),
  validateBody(updatePrioritySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) throw badRequest("Invalid priority id");

    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) throw notFound("Priority");

    const body = req.body as z.infer<typeof updatePrioritySchema>;
    const {
      title, description, severity, department, owner_user_id, accountable_exec_id,
      target_start_date, due_date, target_outcome, sort_order,
      manual_health, manual_progress, project_ids, owner_role, assigned_to,
      status, horizon, next_action, definition_of_done, support, priority_rank,
      scope, parent_id, department_key, assigned_user_id,
    } = body;

    const existingPriority = existing[0] as any;
    const isPriorityAdmin = isPriorityAdminRole(user.role);
    const isDeptHead = isDepartmentHeadRole(user.role);
    const userDept = getDepartmentForRole(user.role);
    const existingScope = (existingPriority.scope || "company") as PriorityScope;
    const existingDept = existingPriority.departmentKey || null;
    const canEdit = canPriorityRoleEditPriority(
      { role: user.role, userId: user.id, departmentKey: userDept || null },
      {
        scope: existingScope,
        departmentKey: existingDept,
        ownerUserId: existingPriority.ownerUserId ?? null,
        assignedUserId: existingPriority.assignedUserId ?? null,
      },
    );
    if (!canEdit) {
      throw forbidden("You cannot edit this priority");
    }

    // Non-admin dept heads may only edit dept/role priorities within their own
    // department, and may not promote a priority to company scope or move it
    // to another department. Mirrors the POST scope guard.
    if (!isPriorityAdmin && isDeptHead) {
      if (existingScope === "company") {
        throw badRequest("Only priority admins can edit company-scope priorities");
      }
      if (existingDept && userDept && existingDept !== userDept) {
        throw badRequest("You may only edit priorities within your own department");
      }
      if (scope && scope !== "department" && scope !== "role") {
        throw badRequest("Dept-head users cannot promote a priority to company scope");
      }
      if (department_key && userDept && department_key !== userDept) {
        throw badRequest("You may only assign priorities to your own department");
      }
    } else if (!isPriorityAdmin) {
      assertRegularPriorityUpdateFields(body as Record<string, any>, existingPriority);
    }

    const nextScope = (scope ?? existingScope) as PriorityScope;
    const nextDepartmentKey = department_key !== undefined
      ? department_key
      : existingDept;
    const nextParentId = parent_id !== undefined
      ? parent_id
      : existingPriority.parentId ?? null;
    await assertPriorityParentLink({
      childId: priorityId,
      scope: nextScope,
      departmentKey: nextDepartmentKey ?? null,
      parentId: nextParentId ?? null,
    });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (severity !== undefined) updates.severity = severity;
    if (department !== undefined) updates.department = department;
    if (owner_user_id !== undefined) updates.ownerUserId = owner_user_id;
    if (accountable_exec_id !== undefined) updates.accountableExecId = accountable_exec_id;
    if (target_start_date !== undefined) updates.targetStartDate = target_start_date;
    if (due_date !== undefined) updates.dueDate = due_date;
    if (target_outcome !== undefined) updates.targetOutcome = target_outcome;
    if (sort_order !== undefined) updates.sortOrder = sort_order;
    if (manual_health !== undefined) updates.manualHealth = manual_health;
    if (manual_progress !== undefined) updates.manualProgress = manual_progress;
    if (owner_role !== undefined) updates.ownerRole = owner_role;
    if (assigned_to !== undefined) updates.assignedTo = assigned_to;
    if (status !== undefined) updates.status = status;
    if (horizon !== undefined) updates.horizon = horizon;
    if (next_action !== undefined) updates.nextAction = next_action;
    if (definition_of_done !== undefined) updates.definitionOfDone = definition_of_done;
    if (support !== undefined) updates.support = support;
    if (priority_rank !== undefined) updates.priorityRank = priority_rank;
    if (scope !== undefined) updates.scope = scope;
    if (parent_id !== undefined) updates.parentId = parent_id;
    if (department_key !== undefined) updates.departmentKey = department_key;
    if (assigned_user_id !== undefined) updates.assignedUserId = assigned_user_id;
    const progress_source_type = (body as any).progress_source_type;
    const progress_source_ref = (body as any).progress_source_ref;
    if (progress_source_type !== undefined) updates.progressSourceType = progress_source_type;
    if (progress_source_ref !== undefined) updates.progressSourceRef = progress_source_ref;

    // Atomicity: priority row update + project-link replacement must commit
    // or roll back together. Without this, a failure halfway through the
    // link replacement leaves the row updated but with partial links.
    // Activity log writes are deferred until AFTER commit so we never
    // emit "project_linked" events for a transaction that rolled back.
    const pendingActivities: Array<{
      action: PriorityActivityAction;
      fromValue?: string | number | null;
      toValue?: string | number | null;
    }> = [];

    const updated = await runInTransaction(async (tx) => {
      const [row] = await tx.update(mytoolCompanyPriorities)
        .set(updates)
        .where(eq(mytoolCompanyPriorities.id, priorityId))
        .returning();

      // Field-change events — computed pure, then queued for post-commit.
      const activities = computeUpdateActivities({
        before: {
          status: existing[0].status,
          severity: existing[0].severity,
          manualHealth: existing[0].manualHealth,
          manualProgress: existing[0].manualProgress,
          dueDate: existing[0].dueDate,
          assignedUserId: existing[0].assignedUserId,
          ownerUserId: existing[0].ownerUserId,
          accountableExecId: existing[0].accountableExecId,
        },
        after: {
          status: row.status,
          severity: row.severity,
          manualHealth: row.manualHealth,
          manualProgress: row.manualProgress,
          dueDate: row.dueDate,
          assignedUserId: row.assignedUserId,
          ownerUserId: row.ownerUserId,
          accountableExecId: row.accountableExecId,
        },
      });
      for (const ev of activities) {
        pendingActivities.push({ action: ev.action, fromValue: ev.fromValue, toValue: ev.toValue });
      }

      if (project_ids !== undefined) {
        const currentLinks = await tx.select().from(priorityProjects)
          .where(eq(priorityProjects.priorityId, priorityId));
        const currentProjectIds = new Set(currentLinks.map((l: typeof currentLinks[number]) => l.projectId));
        const newProjectIds = new Set(project_ids as number[]);

        const toDelete = currentLinks.filter((l: typeof currentLinks[number]) => !newProjectIds.has(l.projectId));
        if (toDelete.length > 0) {
          await tx.delete(priorityProjects).where(
            inArray(priorityProjects.id, toDelete.map((l: typeof currentLinks[number]) => l.id)),
          );
          for (const link of toDelete) {
            pendingActivities.push({ action: "project_unlinked", toValue: String(link.projectId) });
          }
        }

        const toInsert = (project_ids as number[]).filter(pid => !currentProjectIds.has(pid));
        if (toInsert.length > 0) {
          await tx.insert(priorityProjects).values(
            toInsert.map(pid => ({
              priorityId,
              projectId: pid,
              linkedBy: user.id,
            }))
          );
          for (const pid of toInsert) {
            pendingActivities.push({ action: "project_linked", toValue: String(pid) });
          }
        }
      }

      return row;
    });

    // Fire activities post-commit so a rolled-back transaction never leaves
    // orphan audit entries. recordActivity already swallows its own errors
    // (see priority-activity-log.ts), so audit failure cannot fail the response.
    for (const ev of pendingActivities) {
      await recordActivity({
        priorityId,
        actorUserId: user.id,
        action: ev.action,
        fromValue: ev.fromValue,
        toValue: ev.toValue,
      });
    }

    const metrics = await getPriorityDerivedMetrics(priorityId);
    const enriched = await enrichPriority(updated, metrics);
    res.json(enriched);
  }),
);

// Progress-source options handler. The route is registered before /api/priorities/:id
// so Express does not treat "progress-source-options" as a priority id.
// Picker support — returns the revenue milestones + work items available
// for a given project, so the Edit Priority dialog can populate the
// linked-progress picker. Phases are static (shared/phases.ts) so they
// live entirely in the client.
async function getPriorityProgressSourceOptions(req: Request, res: Response) {
  const projectId = parseInt(String(req.query.projectId ?? ""), 10);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return res.json({ projectId: null, milestones: [], workItems: [] });
  }
  // Project-level authorization — prevents enumerating milestone amounts
  // and invoice numbers across projects the user can't access.
  const scope = getProjectScope(req);
  if (scope.kind !== "full_oversight" && !isProjectAccessible(scope, projectId)) {
    return res.status(403).json({ error: "FORBIDDEN", message: "No access to this project" });
  }
  const milestonesRows: any = await db.execute(sql`
    SELECT id, milestone_name, milestone_no, paid_date, invoice_number,
           amount_ex_vat, expected_payment_date
    FROM normalized_revenue_lines
    WHERE project_id = ${projectId}
      AND deleted_at IS NULL
      AND effective_to IS NULL
    ORDER BY milestone_no NULLS LAST, id ASC
    LIMIT 200
  `);
  const workItemsRows: any = await db.execute(sql`
    SELECT wi.id, wi.title, wi.status,
           COALESCE(pm.percent_complete, wi.percent_complete, 0) AS percent_complete
    FROM work_items wi
    LEFT JOIN work_item_pm pm ON pm.work_item_id = wi.id
    WHERE wi.project_id = ${projectId}
      AND wi.deleted_at IS NULL
    ORDER BY wi.status ASC, wi.id ASC
    LIMIT 500
  `);
  res.json({
    projectId,
    milestones: (milestonesRows.rows || milestonesRows).map((m: any) => ({
      id: m.id,
      name: m.milestone_name,
      no: m.milestone_no,
      amountExVat: m.amount_ex_vat,
      paidDate: m.paid_date,
      invoiceNumber: m.invoice_number,
      expectedPaymentDate: m.expected_payment_date,
    })),
    workItems: (workItemsRows.rows || workItemsRows).map((w: any) => ({
      id: w.id,
      title: w.title,
      status: w.status,
      percentComplete: Number(w.percent_complete || 0),
    })),
  });
}

// ==================== DELETE /api/priorities/:id ====================
// DELETE = archive (soft-delete). Was previously aliased to "set
// status=closed", but that's semantically different — a closed priority
// is still visible on the include-closed view and still relevant for
// audit. Archive removes the row from every default surface but keeps
// it restorable. Children stay live with their parent still recorded;
// archiving a parent with active children is rejected (409) so the
// caller has to deal with descendants intentionally.
router.delete(
  "/api/priorities/:id",
  requireAuth,
  requireCooOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) throw badRequest("Invalid priority id");
    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) throw notFound("Priority");
    if (normalizeTimestamp(existing[0].deletedAt) != null) throw badRequest("Priority is already archived");

    const liveChildren = await db
      .select({ id: mytoolCompanyPriorities.id })
      .from(mytoolCompanyPriorities)
      .where(
        and(
          eq(mytoolCompanyPriorities.parentId, priorityId),
          isNull(mytoolCompanyPriorities.deletedAt),
          activePriorityStatusCondition(),
        ),
      );
    if (liveChildren.length > 0) {
      throw new ApiError(409, "HAS_ACTIVE_CHILDREN",
        "Cannot archive a priority with active sub-priorities. Close or archive each child first.",
        { childCount: liveChildren.length, childIds: liveChildren.map((c: { id: number }) => c.id) });
    }

    const now = new Date();
    await db.update(mytoolCompanyPriorities)
      .set({ deletedAt: now.toISOString(), updatedAt: now })
      .where(eq(mytoolCompanyPriorities.id, priorityId));

    await recordActivity({
      priorityId,
      actorUserId: getEffectiveUser(req)?.id,
      action: "updated",
      fromValue: null,
      toValue: "archived",
      details: { field: "deletedAt", archived: true },
    });

    await fanoutPriorityNotifications({
      priorityId,
      priority: existing[0],
      actorUserId: getEffectiveUser(req)?.id,
      eventType: "priority_archived",
      title: `Archived: ${existing[0].title}`,
      body: "Hidden from default views. Admins can restore it from the archived filter.",
    });

    res.status(204).send();
  }),
);

// POST /api/priorities/:id/restore — undo an archive. Admin-only.
// Idempotent: restoring an already-live priority is a no-op 200.
router.post(
  "/api/priorities/:id/restore",
  requireAuth,
  requireCooOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) throw badRequest("Invalid priority id");
    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) throw notFound("Priority");

    if (normalizeTimestamp(existing[0].deletedAt) != null) {
      const now = new Date();
      await db.update(mytoolCompanyPriorities)
        .set({ deletedAt: null, updatedAt: now })
        .where(eq(mytoolCompanyPriorities.id, priorityId));

      await recordActivity({
        priorityId,
        actorUserId: getEffectiveUser(req)?.id,
        action: "updated",
        fromValue: "archived",
        toValue: null,
        details: { field: "deletedAt", restored: true },
      });
      await fanoutPriorityNotifications({
        priorityId,
        priority: existing[0],
        actorUserId: getEffectiveUser(req)?.id,
        eventType: "priority_restored",
        title: `Restored: ${existing[0].title}`,
        body: "Back in default views.",
      });
    }

    const [updated] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    const metrics = await getPriorityDerivedMetrics(priorityId);
    const enriched = await enrichPriority(updated, metrics);
    res.json(enriched);
  }),
);

// ==================== GET /api/priorities/search ====================
//
// Lightweight free-text search across title + description. Server-side
// filtering of an in-memory result set (priorities is a small table —
// even at the company scale we're talking <10k rows) so we don't need
// pg-trgm or a separate search index. Respects ownership / scope
// visibility via the same filter the list endpoint uses, and excludes
// archived rows unless include_archived=true (admin only).
//
// Query params:
//   q              — required, ≥2 chars. Matches title OR description
//                    case-insensitively, substring.
//   scope          — optional, limit to company|department|role.
//   include_closed — optional, default false. Set to surface
//                    closed/complete priorities in the result.
//   include_archived — optional, admin-only.
//   limit          — optional, default 20, max 100.
// ==================== BULK ENDPOINTS ====================
//
// Single round-trip versions of "loop client-side over each id" patterns
// the priorities page used to do. Each endpoint:
//   - validates the payload via Zod (max 100 ids per call)
//   - loads every referenced priority once and authorises per-id
//   - runs all writes inside runInTransaction so partial failure rolls
//     back the whole batch
//   - returns 200 with a per-id outcome map so the client can show
//     per-row toasts ("4 closed, 1 skipped because …")
//
// Tradeoff vs returning 207-multi-status: keeping a single 200 makes
// the client mutation trivially success/error; per-id errors are
// included in the body. If anything in the batch hits an exception
// outside the per-id loop (e.g. DB unreachable), we fail the whole
// transaction and bubble up as a normal 500.
type BulkOutcome = { id: number; ok: boolean; error?: string };

router.post(
  "/api/priorities/bulk/close",
  requireAuth,
  requirePermission("company_priorities", "view"),
  validateBody(bulkCloseSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const { ids, status } = req.body as z.infer<typeof bulkCloseSchema>;
    const userDept = getDepartmentForRole(user.role);
    const now = new Date();

    const rows = await db.select().from(mytoolCompanyPriorities)
      .where(inArray(mytoolCompanyPriorities.id, ids));
    const byId = new Map<number, any>(rows.map((r: any) => [r.id, r]));

    const outcomes: BulkOutcome[] = [];
    const okIds: number[] = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { outcomes.push({ id, ok: false, error: "not found" }); continue; }
      if (normalizeTimestamp(row.deletedAt) != null) {
        outcomes.push({ id, ok: false, error: "archived" }); continue;
      }
      const allowed = canPriorityRoleEditPriority(
        { role: user.role, userId: user.id, departmentKey: userDept ?? null },
        {
          scope: (row.scope ?? "company") as PriorityScope,
          departmentKey: row.departmentKey ?? null,
          ownerUserId: row.ownerUserId ?? null,
          assignedUserId: row.assignedUserId ?? null,
        },
      );
      if (!allowed) { outcomes.push({ id, ok: false, error: "forbidden" }); continue; }
      if (isPriorityTerminalStatus(row.status)) {
        outcomes.push({ id, ok: false, error: "already terminal" }); continue;
      }
      okIds.push(id);
    }

    if (okIds.length > 0) {
      await runInTransaction(async (tx) => {
        await tx.update(mytoolCompanyPriorities)
          .set({ status, updatedAt: now })
          .where(inArray(mytoolCompanyPriorities.id, okIds));
      });
      for (const id of okIds) {
        outcomes.push({ id, ok: true });
        const row = byId.get(id);
        await recordActivity({
          priorityId: id,
          actorUserId: user.id,
          action: "status_changed",
          fromValue: row?.status ?? null,
          toValue: status,
          details: { source: "bulk" },
        });
        await fanoutPriorityNotifications({
          priorityId: id,
          priority: row,
          actorUserId: user.id,
          eventType: status === "complete" ? "priority_completed" : "priority_closed",
          title: `${status === "complete" ? "Completed" : "Closed"}: ${row.title}`,
        });
      }
    }

    outcomes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    res.json({ processed: okIds.length, total: ids.length, results: outcomes });
  }),
);

router.post(
  "/api/priorities/bulk/escalate",
  requireAuth,
  requirePermission("company_priorities", "view"),
  validateBody(bulkEscalateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const { ids, reason, note } = req.body as z.infer<typeof bulkEscalateSchema>;
    const userDept = getDepartmentForRole(user.role);
    const now = new Date();

    const rows = await db.select().from(mytoolCompanyPriorities)
      .where(inArray(mytoolCompanyPriorities.id, ids));
    const byId = new Map<number, any>(rows.map((r: any) => [r.id, r]));

    const outcomes: BulkOutcome[] = [];
    const pending: Array<{ id: number; row: any; patch: ReturnType<typeof computeEscalatePatch> }> = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { outcomes.push({ id, ok: false, error: "not found" }); continue; }
      if (normalizeTimestamp(row.deletedAt) != null) {
        outcomes.push({ id, ok: false, error: "archived" }); continue;
      }
      const allowed = canPriorityRoleEscalatePriority(
        { role: user.role, userId: user.id, departmentKey: userDept ?? null },
        {
          scope: (row.scope ?? "company") as PriorityScope,
          departmentKey: row.departmentKey ?? null,
          ownerUserId: row.ownerUserId ?? null,
          assignedUserId: row.assignedUserId ?? null,
        },
      );
      if (!allowed) { outcomes.push({ id, ok: false, error: "forbidden" }); continue; }
      const sourceDept = row.departmentKey ?? (row.scope === "role" ? (userDept ?? null) : null);
      const patch = computeEscalatePatch(
        { scope: (row.scope ?? "company") as PriorityScope, departmentKey: sourceDept },
        reason as EscalationReason,
      );
      if (!patch) {
        outcomes.push({ id, ok: false, error: "already at company scope" }); continue;
      }
      pending.push({ id, row, patch });
    }

    if (pending.length > 0) {
      await runInTransaction(async (tx) => {
        for (const { id, patch } of pending) {
          await tx.update(mytoolCompanyPriorities)
            .set({
              scope: patch!.scope,
              departmentKey: patch!.departmentKey,
              escalated: true,
              escalatedAt: now,
              escalationReason: patch!.escalationReason,
              updatedAt: now,
            })
            .where(eq(mytoolCompanyPriorities.id, id));
        }
      });
      for (const { id, row, patch } of pending) {
        outcomes.push({ id, ok: true });
        await recordActivity({
          priorityId: id,
          actorUserId: user.id,
          action: "escalated",
          fromValue: row.scope,
          toValue: patch!.scope,
          details: { reason: patch!.escalationReason, source: "bulk", ...(note ? { note } : {}) },
        });
        await fanoutPriorityNotifications({
          priorityId: id,
          priority: row,
          actorUserId: user.id,
          eventType: "priority_escalated",
          title: `Escalated: ${row.title}`,
          body: `Moved from ${row.scope} to ${patch!.scope}${note ? ` — ${note}` : ""}`,
        });
      }
    }

    outcomes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    res.json({ processed: pending.length, total: ids.length, results: outcomes });
  }),
);

router.post(
  "/api/priorities/bulk/assign",
  requireAuth,
  requirePermission("company_priorities", "view"),
  validateBody(bulkAssignSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const { ids, assigned_user_id } = req.body as z.infer<typeof bulkAssignSchema>;
    const userDept = getDepartmentForRole(user.role);
    const now = new Date();

    if (assigned_user_id != null) {
      const assignee = await getUserById(assigned_user_id);
      if (!assignee) throw badRequest("assigned_user_id not found");
    }

    const rows = await db.select().from(mytoolCompanyPriorities)
      .where(inArray(mytoolCompanyPriorities.id, ids));
    const byId = new Map<number, any>(rows.map((r: any) => [r.id, r]));

    const outcomes: BulkOutcome[] = [];
    const okIds: number[] = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { outcomes.push({ id, ok: false, error: "not found" }); continue; }
      if (normalizeTimestamp(row.deletedAt) != null) {
        outcomes.push({ id, ok: false, error: "archived" }); continue;
      }
      const allowed = canPriorityRoleEditPriority(
        { role: user.role, userId: user.id, departmentKey: userDept ?? null },
        {
          scope: (row.scope ?? "company") as PriorityScope,
          departmentKey: row.departmentKey ?? null,
          ownerUserId: row.ownerUserId ?? null,
          assignedUserId: row.assignedUserId ?? null,
        },
      );
      if (!allowed) { outcomes.push({ id, ok: false, error: "forbidden" }); continue; }
      okIds.push(id);
    }

    if (okIds.length > 0) {
      await runInTransaction(async (tx) => {
        await tx.update(mytoolCompanyPriorities)
          .set({ assignedUserId: assigned_user_id, updatedAt: now })
          .where(inArray(mytoolCompanyPriorities.id, okIds));
      });
      for (const id of okIds) {
        outcomes.push({ id, ok: true });
        const row = byId.get(id);
        await recordActivity({
          priorityId: id,
          actorUserId: user.id,
          action: assigned_user_id == null ? "unassigned" : (row?.assignedUserId ? "reassigned" : "assigned"),
          fromValue: row?.assignedUserId != null ? String(row.assignedUserId) : null,
          toValue: assigned_user_id != null ? String(assigned_user_id) : null,
          details: { source: "bulk" },
        });
      }
    }

    outcomes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    res.json({ processed: okIds.length, total: ids.length, results: outcomes });
  }),
);

// ==================== PRIORITY TEMPLATES ====================
//
// Reusable priority shapes. Admin or dept-head defines a template;
// any user the template targets can instantiate it with one POST.
// Templates are soft-deleted (deleted_at) so existing priorities
// referencing them stay coherent.

const templateUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  title_template: z.string().min(1).max(200),
  body_template: z.string().max(5000).nullable().optional(),
  scope_default: z.enum(["company", "department", "role"]).default("role"),
  severity_default: z.enum(["critical", "important", "normal"]).default("normal"),
  horizon_default: z.enum(["day", "week", "month", "quarter", "year"]).default("week"),
  department_key: z.string().max(120).nullable().optional(),
  target_outcome: z.string().max(2000).nullable().optional(),
  definition_of_done: z.string().max(2000).nullable().optional(),
  next_action: z.string().max(2000).nullable().optional(),
  owner_role: z.string().max(120).nullable().optional(),
});

// GET — anyone authenticated. Dept heads see their own dept's
// templates + any template with no department pinned. Regular users
// see only role-scope templates (the only scope they can instantiate).
router.get(
  "/api/priority-templates",
  requireAuth,
  requirePermission("company_priorities", "view"),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const userDept = getDepartmentForRole(user.role);
    const rows = await db
      .select()
      .from(priorityTemplates)
      .where(isNull(priorityTemplates.deletedAt));
    const visible = rows.filter((t: any) => {
      if (isPriorityAdminRole(user.role)) return true;
      if (isDepartmentHeadRole(user.role)) {
        return !t.departmentKey || t.departmentKey === userDept;
      }
      // Regular users: role-scope templates only, no dept lock or their dept.
      if (t.scopeDefault !== "role") return false;
      return !t.departmentKey || t.departmentKey === userDept;
    });
    res.json(visible);
  }),
);

// POST — admin or dept head (dept head limited to their own dept).
router.post(
  "/api/priority-templates",
  requireAuth,
  requirePriorityCreator,
  validateBody(templateUpsertSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const userDept = getDepartmentForRole(user.role);
    const body = req.body as z.infer<typeof templateUpsertSchema>;

    if (!isPriorityAdminRole(user.role)) {
      // Dept head: scope must be role|department and dept must be theirs
      if (body.scope_default === "company") {
        throw badRequest("Only priority admins can create company-scope templates");
      }
      if (body.department_key && body.department_key !== userDept) {
        throw badRequest("You can only create templates for your own department");
      }
      if (!body.department_key) body.department_key = userDept ?? null;
    }

    const [row] = await db.insert(priorityTemplates).values({
      name: body.name,
      description: body.description ?? null,
      titleTemplate: body.title_template,
      bodyTemplate: body.body_template ?? null,
      scopeDefault: body.scope_default,
      severityDefault: body.severity_default,
      horizonDefault: body.horizon_default,
      departmentKey: body.department_key ?? null,
      targetOutcome: body.target_outcome ?? null,
      definitionOfDone: body.definition_of_done ?? null,
      nextAction: body.next_action ?? null,
      ownerRole: body.owner_role ?? null,
      createdByUserId: user.id,
    }).returning();
    res.status(201).json(row);
  }),
);

// PUT — same gate as POST. Patches the template in place.
router.put(
  "/api/priority-templates/:id",
  requireAuth,
  requirePriorityCreator,
  validateBody(templateUpsertSchema.partial()),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseIdParam(req.params.id);
    if (id === null) throw badRequest("Invalid template id");
    const user = getEffectiveUser(req)!;
    const userDept = getDepartmentForRole(user.role);
    const body = req.body as Partial<z.infer<typeof templateUpsertSchema>>;

    const [existing] = await db.select().from(priorityTemplates)
      .where(eq(priorityTemplates.id, id));
    if (!existing || existing.deletedAt) throw notFound("Template");
    if (!isPriorityAdminRole(user.role)) {
      if (existing.departmentKey && existing.departmentKey !== userDept) {
        throw forbidden("Not your department's template");
      }
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.title_template !== undefined) updates.titleTemplate = body.title_template;
    if (body.body_template !== undefined) updates.bodyTemplate = body.body_template;
    if (body.scope_default !== undefined) updates.scopeDefault = body.scope_default;
    if (body.severity_default !== undefined) updates.severityDefault = body.severity_default;
    if (body.horizon_default !== undefined) updates.horizonDefault = body.horizon_default;
    if (body.department_key !== undefined) updates.departmentKey = body.department_key;
    if (body.target_outcome !== undefined) updates.targetOutcome = body.target_outcome;
    if (body.definition_of_done !== undefined) updates.definitionOfDone = body.definition_of_done;
    if (body.next_action !== undefined) updates.nextAction = body.next_action;
    if (body.owner_role !== undefined) updates.ownerRole = body.owner_role;

    const [row] = await db.update(priorityTemplates)
      .set(updates)
      .where(eq(priorityTemplates.id, id))
      .returning();
    res.json(row);
  }),
);

// DELETE — soft-delete. Same gate.
router.delete(
  "/api/priority-templates/:id",
  requireAuth,
  requirePriorityCreator,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseIdParam(req.params.id);
    if (id === null) throw badRequest("Invalid template id");
    const user = getEffectiveUser(req)!;
    const userDept = getDepartmentForRole(user.role);
    const [existing] = await db.select().from(priorityTemplates)
      .where(eq(priorityTemplates.id, id));
    if (!existing || existing.deletedAt) throw notFound("Template");
    if (!isPriorityAdminRole(user.role) && existing.departmentKey && existing.departmentKey !== userDept) {
      throw forbidden("Not your department's template");
    }
    await db.update(priorityTemplates)
      .set({ deletedAt: new Date().toISOString(), updatedAt: new Date() })
      .where(eq(priorityTemplates.id, id));
    res.status(204).send();
  }),
);

// POST /api/priority-templates/:id/instantiate
// Creates a real priority from this template's defaults. Caller can
// override title via body.title_override (e.g. add date suffix for
// weekly standup templates). Server forces caller as owner/assignee
// for role-scope instantiation per the existing create rules.
const instantiateSchema = z.object({
  title_override: z.string().min(1).max(200).optional(),
  due_date: z.string().max(50).optional(),
});
router.post(
  "/api/priority-templates/:id/instantiate",
  requireAuth,
  requirePermission("company_priorities", "view"),
  validateBody(instantiateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseIdParam(req.params.id);
    if (id === null) throw badRequest("Invalid template id");
    const user = getEffectiveUser(req)!;
    const userDept = getDepartmentForRole(user.role);
    const body = req.body as z.infer<typeof instantiateSchema>;

    const [tpl] = await db.select().from(priorityTemplates)
      .where(eq(priorityTemplates.id, id));
    if (!tpl || tpl.deletedAt) throw notFound("Template");

    const scope = tpl.scopeDefault as PriorityScope;
    // Same authorisation rules as POST /api/priorities
    if (!isPriorityAdminRole(user.role) && !isDepartmentHeadRole(user.role)) {
      if (scope !== "role") {
        throw forbidden("You can only instantiate role-scope templates");
      }
    }
    if (!isPriorityAdminRole(user.role) && isDepartmentHeadRole(user.role)) {
      if (scope === "company") throw forbidden("Only admins can instantiate company-scope templates");
    }

    const now = new Date();
    const ownerUserId = isPriorityAdminRole(user.role) || isDepartmentHeadRole(user.role) ? null : user.id;
    const assignedUserId = ownerUserId;
    const departmentKey = tpl.departmentKey ?? userDept ?? null;

    const [created] = await db.insert(mytoolCompanyPriorities).values({
      title: body.title_override ?? tpl.titleTemplate,
      description: tpl.bodyTemplate ?? null,
      severity: (tpl.severityDefault as any),
      horizon: (tpl.horizonDefault as any),
      scope,
      departmentKey,
      ownerUserId,
      assignedUserId,
      ownerRole: tpl.ownerRole ?? null,
      targetOutcome: tpl.targetOutcome ?? null,
      definitionOfDone: tpl.definitionOfDone ?? null,
      nextAction: tpl.nextAction ?? null,
      dueDate: body.due_date ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    await recordActivity({
      priorityId: created.id,
      actorUserId: user.id,
      action: "created",
      details: { source: "template", templateId: tpl.id, templateName: tpl.name },
    });

    const metrics = await getPriorityDerivedMetrics(created.id);
    const enriched = await enrichPriority(created, metrics);
    res.status(201).json(enriched);
  }),
);

// ==================== POST /api/priorities/:id/projects ====================
router.post(
  "/api/priorities/:id/projects",
  requireAuth,
  requirePriorityAdmin,
  validateBody(linkProjectsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) throw badRequest("Invalid priority id");
    const { project_ids } = req.body as z.infer<typeof linkProjectsSchema>;

    const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (!priority) throw notFound("Priority");

    const projectRows = await db.select({ id: projectInfo.id }).from(projectInfo).where(inArray(projectInfo.id, project_ids));
    if (projectRows.length !== project_ids.length) throw badRequest("One or more project_ids not found");

    // Upsert via ON CONFLICT DO NOTHING — idempotent; the outer for-loop lets
    // us accept a partial insert if a duplicate constraint fires mid-batch.
    for (const pid of project_ids) {
      await db.insert(priorityProjects).values({
        priorityId,
        projectId: pid,
        linkedBy: user.id,
      }).onConflictDoNothing();
      await recordActivity({
        priorityId,
        actorUserId: user.id,
        action: "project_linked",
        toValue: String(pid),
      });
    }

    // Same foundation read as GET /api/priorities/:id linkedProjects so the
    // RAG / % Complete fallbacks (cache → live) apply consistently after a
    // link operation, instead of the old raw join that surfaced "—" for
    // projects with no materialised cache row.
    const linkRows: Array<{ projectId: number; linkedAt: Date | null }> = await db
      .select({ projectId: priorityProjects.projectId, linkedAt: priorityProjects.linkedAt })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));
    const projectIdsLinked: number[] = Array.from(new Set(linkRows.map((r) => r.projectId)));
    const summaryByProjectId = await getProjectListSummaries({ projectIds: projectIdsLinked });
    const linkedProjects = linkRows
      .map((r: { projectId: number; linkedAt: Date | null }) => {
        const s = summaryByProjectId.get(r.projectId);
        if (!s) return null;
        return {
          id: s.id,
          name: s.name,
          phase: s.phase,
          ragStatus: s.ragStatus,
          ragSource: s.ragSource,
          pmName: s.pmName,
          percentComplete: s.percentComplete ?? 0,
          percentCompleteSource: s.percentCompleteSource,
          linkedAt: r.linkedAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    res.json(linkedProjects);
  }),
);

// ==================== POST /api/priorities/:id/opportunities ====================
// Link pre-contract opportunities to a priority. Tier 4 · PR 2 — lets the
// strategic view see pipeline risk (stalled proposals, overdue feasibility)
// without waiting for deals to convert into signed projects.
router.post(
  "/api/priorities/:id/opportunities",
  requireAuth,
  requirePriorityAdmin,
  validateBody(linkOpportunitiesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getEffectiveUser(req)!;
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) throw badRequest("Invalid priority id");
    const { opportunity_ids } = req.body as z.infer<typeof linkOpportunitiesSchema>;

    const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (!priority) throw notFound("Priority");

    const oppRows = await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.id, opportunity_ids));
    if (oppRows.length !== opportunity_ids.length) throw badRequest("One or more opportunity_ids not found");

    for (const oid of opportunity_ids) {
      await db.insert(priorityOpportunities).values({
        priorityId,
        opportunityId: oid,
        linkedBy: user.id,
      }).onConflictDoNothing();
      await recordActivity({
        priorityId,
        actorUserId: user.id,
        action: "project_linked",
        toValue: `opportunity:${oid}`,
        details: { kind: "opportunity", opportunityId: oid },
      });
    }

    res.status(204).send();
  }),
);

// ==================== DELETE /api/priorities/:id/opportunities/:opportunityId ====================
router.delete(
  "/api/priorities/:id/opportunities/:opportunityId",
  requireAuth,
  requirePriorityAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const priorityId = parseIdParam(req.params.id);
    const opportunityId = parseIdParam(req.params.opportunityId);
    if (priorityId === null || opportunityId === null) throw badRequest("Invalid id parameter");

    await db.delete(priorityOpportunities).where(
      and(
        eq(priorityOpportunities.priorityId, priorityId),
        eq(priorityOpportunities.opportunityId, opportunityId),
      )
    );

    await recordActivity({
      priorityId,
      actorUserId: getEffectiveUser(req)?.id,
      action: "project_unlinked",
      toValue: `opportunity:${opportunityId}`,
      details: { kind: "opportunity", opportunityId },
    });

    res.status(204).send();
  }),
);

// ==================== DELETE /api/priorities/:id/projects/:projectId ====================
router.delete(
  "/api/priorities/:id/projects/:projectId",
  requireAuth,
  requirePriorityAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const priorityId = parseIdParam(req.params.id);
    const projectId = parseIdParam(req.params.projectId);
    if (priorityId === null || projectId === null) throw badRequest("Invalid id parameter");

    await db.delete(priorityProjects).where(
      and(
        eq(priorityProjects.priorityId, priorityId),
        eq(priorityProjects.projectId, projectId),
      )
    );

    await recordActivity({
      priorityId,
      actorUserId: getEffectiveUser(req)?.id,
      action: "project_unlinked",
      toValue: String(projectId),
    });

    res.status(204).send();
  }),
);

// ==================== GET /api/projects/:id/priorities ====================
// Bottom-up: returns priorities linked DIRECTLY to this project PLUS every
// ancestor priority up the parentId chain. Each row carries `linkedDirectly`
// so the UI can group "Direct priorities" vs "Rolls up into …".
//
// This is the symmetric companion to GET /api/priorities/:id — that endpoint
// walks DOWN the tree to aggregate a Company priority's descendants; this
// endpoint walks UP so a PM can see which strategic priorities their project
// actually feeds.
router.get(
  "/api/projects/:id/priorities",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = parseIdParam(req.params.id);
    if (projectId === null) throw badRequest("Invalid project id");

    // Direct links for this project
    const directRows = await db
      .select({
        id: mytoolCompanyPriorities.id,
        title: mytoolCompanyPriorities.title,
        severity: mytoolCompanyPriorities.severity,
        manualHealth: mytoolCompanyPriorities.manualHealth,
        status: mytoolCompanyPriorities.status,
        dueDate: mytoolCompanyPriorities.dueDate,
        scope: mytoolCompanyPriorities.scope,
        parentId: mytoolCompanyPriorities.parentId,
      })
      .from(priorityProjects)
      .innerJoin(mytoolCompanyPriorities, eq(priorityProjects.priorityId, mytoolCompanyPriorities.id))
      .where(and(
        eq(priorityProjects.projectId, projectId),
        activePriorityStatusCondition(),
      ));

    // Load the full adjacency once so we can walk ancestors cheaply.
    const adjacency = await db
      .select({ id: mytoolCompanyPriorities.id, parentId: mytoolCompanyPriorities.parentId })
      .from(mytoolCompanyPriorities)
      .where(activePriorityStatusCondition());

    const directIds = new Set(directRows.map((r: typeof directRows[number]) => r.id));
    const ancestorIdSet = new Set<number>();
    for (const r of directRows) {
      for (const anc of collectAncestorIds(
        adjacency.map((a: { id: number; parentId: number | null }) => ({ id: a.id, parentId: a.parentId })),
        r.id,
      )) {
        if (!directIds.has(anc)) ancestorIdSet.add(anc);
      }
    }

    // Fetch ancestor detail in a single round trip.
    const ancestorRows = ancestorIdSet.size === 0 ? [] : await db
      .select({
        id: mytoolCompanyPriorities.id,
        title: mytoolCompanyPriorities.title,
        severity: mytoolCompanyPriorities.severity,
        manualHealth: mytoolCompanyPriorities.manualHealth,
        status: mytoolCompanyPriorities.status,
        dueDate: mytoolCompanyPriorities.dueDate,
        scope: mytoolCompanyPriorities.scope,
        parentId: mytoolCompanyPriorities.parentId,
      })
      .from(mytoolCompanyPriorities)
      .where(inArray(mytoolCompanyPriorities.id, Array.from(ancestorIdSet)));

    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

    const shape = (row: typeof directRows[number], linkedDirectly: boolean) => {
      const metrics = metricsMap.get(row.id);
      const projectCount = Number(metrics?.project_count || 0);
      const { health: effectiveHealth } = computeEffectivePriorityHealth({
        manualHealth: row.manualHealth as PriorityHealth | null,
        derivedHealth: projectCount > 0 ? (metrics?.derived_health ?? null) : null,
        severity: row.severity,
        dueDate: row.dueDate,
        status: row.status,
        blockerCount: Number(metrics?.blocker_count || 0),
        engBlockerCount: Number(metrics?.eng_blocker_count || 0),
        qualityDefectCount: Number(metrics?.quality_defect_count || 0),
        hseIncidentCount: Number(metrics?.hse_incident_count || 0),
        hseCriticalCount: Number(metrics?.hse_critical_count || 0),
      });
      return {
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        scope: row.scope,
        parentId: row.parentId,
        effectiveHealth,
        linkedDirectly,
      };
    };

    const result = [
      ...directRows.map((r: typeof directRows[number]) => shape(r, true)),
      ...ancestorRows.map((r: typeof ancestorRows[number]) => shape(r, false)),
    ];

    res.json(result);
  }),
);

// ==================== GET /api/priorities/:id/tasks ====================
// Rolled-up: returns open tasks across every project linked to this priority
// OR any descendant. Matches the status filter used by priority_derived_metrics
// .open_task_count so the card counter and drill-down list stay in sync.
router.get("/api/priorities/:id/tasks", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const { rolledUpProjectIds: projectIds } = await resolveRolledUpScope(priorityId);
  if (projectIds.length === 0) return res.json([]);

    // Get project names for context
    const projects = await db.select({ id: projectInfo.id, name: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    const projectNameMap = new Map(projects.map((p: typeof projects[number]) => [p.id, p.name]));

    // Get OPEN tasks from linked projects — matches the filter used by the
    // priority_derived_metrics.open_task_count column so the card count and
    // the drill-down list always agree.
    const tasks = await db
      .select({
        id: workItems.id,
        title: workItems.title,
        status: workItems.status,
        priority: workItems.priority,
        endDate: workItems.endDate,
        projectId: workItems.projectId,
        ownerUserId: workItems.ownerUserId,
        ownerName: workItems.ownerName,
        percentComplete: workItems.percentComplete,
      })
      .from(workItems)
      .where(and(
        inArray(workItems.projectId, projectIds),
        isNull(workItems.deletedAt),
        sql`LOWER(${workItems.status}) NOT IN ('complete', 'completed', 'done', 'cancelled', 'canceled', 'qc approved')`,
      ))
      .orderBy(asc(workItems.endDate));

    const result = tasks.map((t: typeof tasks[number]) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.endDate,
      projectId: t.projectId,
      projectName: projectNameMap.get(t.projectId) || "Unknown",
      assignee: t.ownerName || null,
      assigneeId: t.ownerUserId,
      percentComplete: t.percentComplete,
      type: "task",
    }));

    // Sort: blocked first, then overdue, then by due date
    const now = new Date().toISOString().slice(0, 10);
    result.sort((a: typeof result[number], b: typeof result[number]) => {
      const aBlocked = a.status?.toLowerCase().includes("block") ? 0 : 1;
      const bBlocked = b.status?.toLowerCase().includes("block") ? 0 : 1;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;

      const aOverdue = a.dueDate && a.dueDate < now && !["complete", "completed", "done", "cancelled"].includes(a.status?.toLowerCase() || "") ? 0 : 1;
      const bOverdue = b.dueDate && b.dueDate < now && !["complete", "completed", "done", "cancelled"].includes(b.status?.toLowerCase() || "") ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;

      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

  res.json(result);
}));

// ==================== GET /api/priorities/:id/approvals ====================
// Rolled-up: includes pending approvals across every project linked to this
// priority OR any descendant priority.
router.get("/api/priorities/:id/approvals", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const { rolledUpProjectIds: projectIds } = await resolveRolledUpScope(priorityId);
  if (projectIds.length === 0) return res.json([]);

    // Get project names
    const projects = await db.select({ id: projectInfo.id, name: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    const projectNameMap = new Map(projects.map((p: typeof projects[number]) => [p.id, p.name]));

    const pendingApprovals = await db
      .select()
      .from(approvals)
      .where(and(
        inArray(approvals.projectId, projectIds),
        eq(approvals.status, "pending"),
      ))
      .orderBy(asc(approvals.dueDate));

    const result = pendingApprovals.map((a: typeof pendingApprovals[number]) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      status: a.status,
      projectId: a.projectId,
      projectName: projectNameMap.get(a.projectId) || "Unknown",
      requestedAt: a.requestedAt,
      dueDate: a.dueDate,
      approvalCategory: a.approvalCategory,
      itemType: "approval",
    }));

  res.json(result);
}));

// ==================== GET /api/priorities/:id/updates ====================
// Rolled-up: RAG / phase updates across every project linked to this priority
// OR any descendant priority.
router.get("/api/priorities/:id/updates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const { rolledUpProjectIds: projectIds } = await resolveRolledUpScope(priorityId);
  if (projectIds.length === 0) return res.json([]);

    // Get latest updates from project_execution_state and project_info
    const projectsWithUpdates = await db
      .select({
        id: projectInfo.id,
        name: projectInfo.projectName,
        phase: projectExecutionState.phase,
        ragStatus: projectExecutionState.ragStatus,
        ragComment: projectExecutionState.ragComment,
        ragUpdatedAt: projectExecutionState.ragUpdatedAt,
        phaseNotes: projectExecutionState.phaseNotes,
        phaseUpdatedAt: projectExecutionState.phaseUpdatedAt,
        updatedAt: projectExecutionState.updatedAt,
      })
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectInfo.id, projectExecutionState.projectId))
      .where(inArray(projectInfo.id, projectIds))
      .orderBy(desc(projectExecutionState.updatedAt));

    const updates = projectsWithUpdates
      .filter((p: typeof projectsWithUpdates[number]) => p.ragComment || p.phaseNotes)
      .map((p: typeof projectsWithUpdates[number]) => ({
        projectId: p.id,
        projectName: p.name,
        phase: p.phase,
        ragStatus: p.ragStatus,
        ragComment: p.ragComment,
        phaseNotes: p.phaseNotes,
        date: p.ragUpdatedAt || p.phaseUpdatedAt || p.updatedAt,
      }));

  res.json(updates);
}));

// ==================== POST /api/priorities/:id/escalate ====================
// Promotes a priority one scope upward (role → department → company) atomically.
//
// Design note: the previous implementation inserted a *new* parent priority at
// the next scope and linked the original as a child. That caused (1) the same
// issue to appear twice in the UI — once at the original scope, once at the
// new scope — and (2) a non-atomic three-write sequence that could leave the
// row flagged `escalated=true` with no parent if any write failed.
//
// New contract: a single UPDATE promotes `scope` in place, records the
// escalation (`escalated=true`, `escalatedAt`, `escalationReason`), and
// clears `departmentKey` when promoting to company scope. Break-down children
// keep their `parentId` — the promoted row simply appears at the higher scope
// while still visibly linked to its parent.
router.post(
  "/api/priorities/:id/escalate",
  requireAuth,
  // Keep the entity-permission read gate so CI route-coverage tooling
  // still recognises this route as guarded. The actual escalation
  // authority is enforced by `canPriorityRoleEscalatePriority()` below,
  // which is ownership-aware: a role-priority's owner or assignee may
  // self-escalate to department; only admins/dept heads can lift higher.
  requirePermission("company_priorities", "view"),
  validateBody(escalatePrioritySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) throw badRequest("Invalid priority id");
    const { reason, note } = req.body as z.infer<typeof escalatePrioritySchema>;

    const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (!priority) throw notFound("Priority");

    const user = getEffectiveUser(req);
    if (!user?.id || !user?.role) throw forbidden("Authentication required");
    const userDept = getDepartmentForRole(user.role);
    const canEscalate = canPriorityRoleEscalatePriority(
      { role: user.role, userId: user.id, departmentKey: userDept ?? null },
      {
        scope: (priority.scope ?? "company") as PriorityScope,
        departmentKey: priority.departmentKey ?? null,
        ownerUserId: priority.ownerUserId ?? null,
        assignedUserId: priority.assignedUserId ?? null,
      },
    );
    if (!canEscalate) {
      throw forbidden("You do not have permission to escalate this priority");
    }

    // Defensive: a role-scope priority created before departmentKey
    // back-fill may have no department pinned. Once a non-admin owner
    // escalates it to department scope, the row needs a concrete
    // department or it lands as an orphan. Use the caller's department
    // as the fallback.
    const sourceDepartmentKey = priority.departmentKey
      ?? (priority.scope === "role" ? (userDept ?? null) : null);

    const patch = computeEscalatePatch(
      {
        scope: (priority.scope ?? "company") as PriorityScope,
        departmentKey: sourceDepartmentKey,
      },
      (reason as EscalationReason | undefined) ?? "manual",
    );
    if (!patch) {
      throw badRequest("Company-level priorities cannot be escalated further");
    }

    const now = new Date();

    // Atomic: a single UPDATE is inherently atomic. Wrapping in a transaction
    // so later additions (audit-log insert, etc.) inherit the atomicity.
    const [updated] = await runInTransaction(async (tx) => {
      return tx.update(mytoolCompanyPriorities)
        .set({
          scope: patch.scope,
          departmentKey: patch.departmentKey,
          escalated: true,
          escalatedAt: now,
          escalationReason: patch.escalationReason,
          updatedAt: now,
        })
        .where(eq(mytoolCompanyPriorities.id, priorityId))
        .returning();
    });

    await recordActivity({
      priorityId,
      actorUserId: getEffectiveUser(req)?.id,
      action: "escalated",
      fromValue: priority.scope,
      toValue: patch.scope,
      details: { reason: patch.escalationReason, ...(note ? { note } : {}) },
    });

    await fanoutPriorityNotifications({
      priorityId,
      priority,
      actorUserId: getEffectiveUser(req)?.id,
      eventType: "priority_escalated",
      title: `Escalated: ${priority.title}`,
      body: `Moved from ${priority.scope} to ${patch.scope}${note ? ` — ${note}` : ""}`,
    });

    // Tier 4 · PR 5 — outbound signal. Emit a RAID "issue" on every directly
    // linked project so department boards pick up the escalation context.
    // Idempotent: we use a stable title so re-running doesn't spam; linked
    // projects that already have a matching open RAID row get skipped.
    try {
      const linkedProjectRows = await db
        .select({ projectId: priorityProjects.projectId })
        .from(priorityProjects)
        .where(eq(priorityProjects.priorityId, priorityId));
      const raidTitle = `[Priority escalated] ${priority.title}`;
      const actorUserId = getEffectiveUser(req)?.id ?? null;
      for (const { projectId } of linkedProjectRows) {
        const existing = await db
          .select({ id: raidItems.id })
          .from(raidItems)
          .where(and(
            eq(raidItems.projectId, projectId),
            eq(raidItems.title, raidTitle),
            isNull(raidItems.deletedAt),
          ))
          .limit(1);
        if (existing.length > 0) continue;
        await db.insert(raidItems).values({
          projectId,
          type: "issue",
          title: raidTitle,
          description: `Priority "${priority.title}" was escalated from ${priority.scope} to ${patch.scope} (${patch.escalationReason}). Review the priority and align this project's plan.`,
          status: "open",
          priority: patch.scope === "company" ? "critical" : "high",
          createdByUserId: actorUserId,
        });
      }
    } catch (err: any) {
      // Escalation must not fail just because the RAID emit failed.
      console.warn("[Priorities] RAID emit on escalation failed:", err?.message || err);
    }

    const metrics = await getPriorityDerivedMetrics(priorityId);
    const enriched = await enrichPriority(updated, metrics);
    res.json(enriched);
  }),
);

// ==================== GET /api/priorities/:id/children ====================
router.get("/api/priorities/:id/children", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const children = await db.select().from(mytoolCompanyPriorities)
    .where(and(
      eq(mytoolCompanyPriorities.parentId, priorityId),
      activePriorityStatusCondition(),
    ));

  if (children.length === 0) return res.json([]);

  const allMetrics = await getAllPriorityDerivedMetrics();
  const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));
  const liveProgressMap = await getPriorityLiveProgressMap(children.map((p: any) => Number(p.id)));

  const userIds = Array.from(new Set(
    children.flatMap((p: any) => [p.ownerUserId, p.accountableExecId, p.assignedUserId].filter(Boolean)),
  )) as number[];
  const userMap = await getUsersByIds(userIds);

  // Get grandchild counts
  const childIds = children.map((c: typeof children[number]) => c.id);
  const grandChildResult: any = getDbMode() === "sqlite"
    ? await db.execute(sql`
      SELECT parent_id, COUNT(*) AS child_count
      FROM mytool_company_priorities
      WHERE parent_id IN (${sql.join(childIds.map((id: number) => sql`${id}`), sql`, `)}) AND ${activePriorityStatusSql()}
      GROUP BY parent_id
    `)
    : await db.execute(sql`
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM mytool_company_priorities
      WHERE parent_id = ANY(${childIds}) AND ${activePriorityStatusSql()}
      GROUP BY parent_id
    `);
  const grandChildCountMap = new Map<number, number>();
  for (const row of (grandChildResult.rows || grandChildResult || [])) {
    grandChildCountMap.set(Number(row.parent_id), Number(row.child_count || 0));
  }

  const enriched = await Promise.all(
    children.map((p: any) => enrichPriority(
      p,
      metricsMap.get(p.id),
      userMap,
      new Map(),
      grandChildCountMap,
      liveProgressMap.get(p.id) ?? null,
    ))
  );

  // Group by department for display
  enriched.sort((a, b) => {
    const deptA = a.departmentKey || "";
    const deptB = b.departmentKey || "";
    if (deptA !== deptB) return deptA.localeCompare(deptB);
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  res.json(enriched);
}));

// ==================== POST /api/priorities/:id/break-down ====================
// Creates child priorities from a parent — used by COO to push down to departments
router.post(
  "/api/priorities/:id/break-down",
  requireAuth,
  requirePriorityAdmin,
  validateBody(breakDownSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const parentId = parseIdParam(req.params.id);
    if (parentId === null) throw badRequest("Invalid parent id");
    const { children } = req.body as z.infer<typeof breakDownSchema>;

    const [parent] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, parentId));
    if (!parent) throw notFound("Parent priority");

    const currentScope = parent.scope ?? "company";
    const childScope: PriorityScope = currentScope === "company" ? "department" : "role";

    const actorUserId = getEffectiveUser(req)?.id;
    const now = new Date();
    const created: any[] = [];
    for (const child of children) {
      const [row] = await db.insert(mytoolCompanyPriorities).values({
        title: child.title,
        description: child.description || null,
        severity: child.severity || parent.severity,
        department: child.department || parent.department,
        dueDate: child.due_date || parent.dueDate,
        horizon: parent.horizon || "quarter",
        scope: childScope,
        parentId: parentId,
        departmentKey: child.department_key || null,
        assignedUserId: child.assigned_user_id || null,
        ownerUserId: child.owner_user_id || null,
        createdAt: now,
        updatedAt: now,
      }).returning();
      created.push(row);
      // Log on both the child (created) and the parent (broken_down) so the
      // event appears in both activity timelines.
      await recordActivity({
        priorityId: row.id,
        actorUserId,
        action: "created",
        toValue: row.title,
        details: { parentId, scope: row.scope },
      });
    }
    await recordActivity({
      priorityId: parentId,
      actorUserId,
      action: "broken_down",
      details: { childCount: created.length, childIds: created.map((c) => c.id) },
    });

    res.status(201).json(created);
  }),
);

// ==================== GET /api/priorities/:id/project-ids ====================
// Lightweight endpoint for department dashboards (engineering / quality /
// HSE / PD) to filter their project lists by a chosen priority. Returns the
// rolled-up project ID set — direct links plus every descendant priority's
// links, deduped. Tier 4 · PR 6.
router.get("/api/priorities/:id/project-ids", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const { directProjectIds, rolledUpProjectIds, descendantPriorityIds } = await resolveRolledUpScope(priorityId);

  res.json({
    priorityId,
    directProjectIds,
    rolledUpProjectIds,
    descendantPriorityCount: descendantPriorityIds.length,
  });
}));

// ==================== GET /api/priorities/:id/activity ====================
// Returns the append-only activity timeline for a priority, newest-first.
//
// Tier 4 · PR 4: when called with ?include_project_events=true the response
// also merges inherited events from linked projects (RAG transitions,
// phase changes) so the timeline reflects the full cross-departmental
// history, not just priority-level mutations.
router.get("/api/priorities/:id/activity", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const limit = Math.min(parseInt((req.query.limit as string) || "100", 10) || 100, 500);
  const includeProjectEvents = req.query.include_project_events === "true";

  const rows = await db
    .select()
    .from(priorityActivity)
    .where(eq(priorityActivity.priorityId, priorityId))
    .orderBy(desc(priorityActivity.createdAt))
    .limit(limit);

  // Enrich to-value / from-value with user names when the value is a numeric
  // user id, so the UI doesn't have to resolve these separately.
  const userIdsFromValues = new Set<number>();
  for (const r of rows) {
    for (const raw of [r.fromValue, r.toValue]) {
      if (!raw) continue;
      if (r.action === "assigned" || r.action === "reassigned" || r.action === "unassigned"
          || r.action === "owner_changed" || r.action === "accountable_exec_changed") {
        const n = Number(raw);
        if (!Number.isNaN(n) && n > 0) userIdsFromValues.add(n);
      }
    }
  }
  const userNameMap = await getUsersByIds(Array.from(userIdsFromValues));

  const enriched: any[] = rows.map((r: typeof rows[number]) => ({
    id: r.id,
    priorityId: r.priorityId,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    action: r.action,
    fromValue: r.fromValue,
    toValue: r.toValue,
    fromName: r.fromValue && userNameMap.get(Number(r.fromValue))?.name || null,
    toName: r.toValue && userNameMap.get(Number(r.toValue))?.name || null,
    details: r.details,
    createdAt: r.createdAt,
    source: "priority",
  }));

  if (includeProjectEvents) {
    // Pull inherited events from the rolled-up project set. We read
    // `project_execution_state.rag_updated_at` / `phase_updated_at` so each
    // linked project contributes at most two events — its latest RAG change
    // and its latest phase transition. Cheaper than streaming every
    // individual project-side event; good enough for a strategic timeline.
    const { rolledUpProjectIds } = await resolveRolledUpScope(priorityId);
    if (rolledUpProjectIds.length > 0) {
      const projectEvents = await db
        .select({
          id: projectInfo.id,
          name: projectInfo.projectName,
          phase: projectExecutionState.phase,
          ragStatus: projectExecutionState.ragStatus,
          ragComment: projectExecutionState.ragComment,
          ragUpdatedAt: projectExecutionState.ragUpdatedAt,
          phaseNotes: projectExecutionState.phaseNotes,
          phaseUpdatedAt: projectExecutionState.phaseUpdatedAt,
        })
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectInfo.id, projectExecutionState.projectId))
        .where(inArray(projectInfo.id, rolledUpProjectIds));

      for (const ev of projectEvents) {
        if (ev.ragUpdatedAt && ev.ragStatus) {
          enriched.push({
            id: `proj-rag-${ev.id}`,
            priorityId,
            actorUserId: null,
            actorName: ev.name,
            action: "project_rag_update",
            fromValue: null,
            toValue: ev.ragStatus,
            fromName: null,
            toName: null,
            details: { projectId: ev.id, projectName: ev.name, comment: ev.ragComment },
            createdAt: ev.ragUpdatedAt,
            source: "project",
          });
        }
        if (ev.phaseUpdatedAt && ev.phase) {
          enriched.push({
            id: `proj-phase-${ev.id}`,
            priorityId,
            actorUserId: null,
            actorName: ev.name,
            action: "project_phase_change",
            fromValue: null,
            toValue: ev.phase,
            fromName: null,
            toName: null,
            details: { projectId: ev.id, projectName: ev.name, notes: ev.phaseNotes },
            createdAt: ev.phaseUpdatedAt,
            source: "project",
          });
        }
      }

      // Re-sort merged list by timestamp descending.
      enriched.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    }
  }

  res.json(enriched);
}));

// ==================== GET /api/reports/priorities-pack (PDF) ====================
// Executive priorities pack — PDF summary of active priorities grouped by
// scope, with health / severity / overdue highlights. Leverages the
// pdfkit pattern from server/departments/board-pack-routes.ts.
router.get("/api/reports/priorities-pack", requireAuth, requirePriorityCreator, asyncHandler(async (req: Request, res: Response) => {
  const scopeFilter = typeof req.query.scope === "string" ? req.query.scope : null;
  const departmentFilter = typeof req.query.department === "string" ? req.query.department : null;

  let rows = await db.select().from(mytoolCompanyPriorities);
  rows = rows.filter((p: any) => !isPriorityTerminalStatus(p.status));
  if (scopeFilter && PRIORITY_SCOPES.includes(scopeFilter as PriorityScope)) {
    rows = rows.filter((p: any) => (p.scope ?? "company") === scopeFilter);
  }
  if (departmentFilter) {
    rows = rows.filter((p: any) => (p.departmentKey ?? p.department_key) === departmentFilter);
  }

  const allMetrics = await getAllPriorityDerivedMetrics();
  const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));
  const liveProgressMap = await getPriorityLiveProgressMap(rows.map((p: any) => Number(p.id)));

  const userIds = Array.from(new Set(
    rows.flatMap((p: any) => [p.ownerUserId, p.accountableExecId, p.assignedUserId].filter(Boolean)),
  )) as number[];
  const userMap = await getUsersByIds(userIds);

  const enriched = await Promise.all(
    rows.map((p: any) => enrichPriority(
      p,
      metricsMap.get(p.id),
      userMap,
      undefined,
      undefined,
      liveProgressMap.get(p.id) ?? null,
    )),
  );

  // Load pdfkit lazily so the import cost is paid only when the endpoint is hit.
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: { Title: "Priorities Pack", Author: "Emergent Energy" },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="priorities-pack-${new Date().toISOString().slice(0, 10)}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).font("Helvetica-Bold").text("Priorities Pack", { align: "center" });
  doc.fontSize(10).font("Helvetica").text(
    `Generated: ${new Date().toLocaleDateString("en-ZA")}${scopeFilter ? ` · scope=${scopeFilter}` : ""}${departmentFilter ? ` · dept=${departmentFilter}` : ""}`,
    { align: "center" },
  );
  doc.moveDown(1.5);

  const healthCounts: Record<string, number> = { critical: 0, at_risk: 0, healthy: 0 };
  const sevCounts: Record<string, number> = { critical: 0, important: 0, normal: 0 };
  let overdueCount = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const p of enriched) {
    healthCounts[p.effectiveHealth] = (healthCounts[p.effectiveHealth] || 0) + 1;
    sevCounts[p.severity] = (sevCounts[p.severity] || 0) + 1;
    if (p.dueDate && p.dueDate < today) overdueCount++;
  }

  doc.fontSize(14).font("Helvetica-Bold").text("Summary");
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Active priorities: ${enriched.length}`);
  doc.text(`Health: ${healthCounts.critical} critical · ${healthCounts.at_risk} at risk · ${healthCounts.healthy} healthy`);
  doc.text(`Severity: ${sevCounts.critical} critical · ${sevCounts.important} high · ${sevCounts.normal} normal`);
  doc.text(`Overdue: ${overdueCount}`);
  doc.moveDown(1);

  // Sort for display — worst first.
  const sevOrder: Record<string, number> = { critical: 0, important: 1, normal: 2 };
  const healthOrder: Record<string, number> = { critical: 0, at_risk: 1, healthy: 2 };
  enriched.sort((a, b) => {
    const hA = healthOrder[a.effectiveHealth] ?? 2;
    const hB = healthOrder[b.effectiveHealth] ?? 2;
    if (hA !== hB) return hA - hB;
    const sA = sevOrder[a.severity] ?? 2;
    const sB = sevOrder[b.severity] ?? 2;
    if (sA !== sB) return sA - sB;
    return (a.dueDate || "").localeCompare(b.dueDate || "");
  });

  doc.fontSize(14).font("Helvetica-Bold").text("Priorities");
  doc.moveDown(0.5);
  for (const p of enriched) {
    if (doc.y > 720) doc.addPage();
    const daysOverdue = p.dueDate && p.dueDate < today
      ? Math.ceil((Date.parse(today + "T00:00:00Z") - Date.parse(p.dueDate + "T00:00:00Z")) / 86_400_000)
      : null;
    doc.fontSize(11).font("Helvetica-Bold").text(p.title);
    doc.fontSize(9).font("Helvetica").fillColor("#444").text(
      `${p.scope} · severity ${p.severity} · health ${p.effectiveHealth}` +
      `${p.dueDate ? ` · due ${p.dueDate}${daysOverdue != null ? ` (${daysOverdue}d overdue)` : ""}` : ""}` +
      `${p.owner?.name ? ` · owner ${p.owner.name}` : ""}` +
      `${p.projectCount > 0 ? ` · ${p.projectCount} project${p.projectCount === 1 ? "" : "s"}` : ""}`,
    ).fillColor("black");
    if (p.description) {
      doc.fontSize(9).font("Helvetica-Oblique").fillColor("#666").text(p.description, { width: 500 }).fillColor("black");
    }
    doc.moveDown(0.6);
  }

  doc.end();
}));

// ==================== POST /api/priorities/:id/reopen ====================
router.post("/api/priorities/:id/reopen", requireAuth, requirePermission("company_priorities", "view"), requirePriorityAdmin, asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
  if (!priority) throw notFound("Priority");
  if (priority.status !== "closed" && priority.status !== "complete") {
    throw badRequest("Priority is not closed");
  }

  const now = new Date();
  const [updated] = await db.update(mytoolCompanyPriorities)
    .set({ status: "active", updatedAt: now })
    .where(eq(mytoolCompanyPriorities.id, priorityId))
    .returning();

  // Use the dedicated "reopened" action so the activity timeline shows
  // the semantic event, not a generic "updated" entry. The
  // PriorityActivityAction union already includes "reopened".
  await recordActivity({
    priorityId,
    actorUserId: getEffectiveUser(req)?.id,
    action: "reopened",
    fromValue: priority.status,
    toValue: "active",
    details: { field: "status" },
  });

  await fanoutPriorityNotifications({
    priorityId,
    priority,
    actorUserId: getEffectiveUser(req)?.id,
    eventType: "priority_reopened",
    title: `Reopened: ${priority.title}`,
    body: `Status moved from ${priority.status} back to active.`,
  });

  const metrics = await getPriorityDerivedMetrics(priorityId);
  const enriched = await enrichPriority(updated, metrics);
  res.json(enriched);
}));

// ==================== GET /api/priorities/:id/comments ====================
router.get("/api/priorities/:id/comments", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const rows = await db
    .select({
      id: priorityComments.id,
      priorityId: priorityComments.priorityId,
      authorUserId: priorityComments.authorUserId,
      authorName: priorityComments.authorName,
      body: priorityComments.body,
      editedAt: priorityComments.editedAt,
      createdAt: priorityComments.createdAt,
    })
    .from(priorityComments)
    .where(and(
      eq(priorityComments.priorityId, priorityId),
      isNull(priorityComments.deletedAt),
    ))
    .orderBy(asc(priorityComments.createdAt));

  res.json(rows);
}));

// ==================== POST /api/priorities/:id/comments ====================
router.post("/api/priorities/:id/comments", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const schema = z.object({ body: z.string().min(1).max(5000) });
  const { body } = schema.parse(req.body);

  const [priority] = await db.select({ id: mytoolCompanyPriorities.id }).from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
  if (!priority) throw notFound("Priority");

  const [comment] = await db.insert(priorityComments).values({
    priorityId,
    authorUserId: user.id,
    authorName: user.name ?? null,
    body,
  }).returning();

  await recordActivity({
    priorityId,
    actorUserId: user.id,
    action: "commented",
    details: { commentId: comment.id, preview: body.slice(0, 120) },
  });

  res.status(201).json(comment);
}));

// ==================== DELETE /api/priorities/:id/comments/:commentId ====================
router.delete("/api/priorities/:id/comments/:commentId", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");
  const priorityId = parseIdParam(req.params.id);
  const commentId = parseIdParam(req.params.commentId);
  if (priorityId === null || commentId === null) throw badRequest("Invalid id");

  const [comment] = await db
    .select({ id: priorityComments.id, authorUserId: priorityComments.authorUserId })
    .from(priorityComments)
    .where(and(eq(priorityComments.id, commentId), eq(priorityComments.priorityId, priorityId), isNull(priorityComments.deletedAt)));

  if (!comment) throw notFound("Comment");

  const isAdmin = isPriorityAdminRole(user.role as any);
  if (comment.authorUserId !== user.id && !isAdmin) {
    throw forbidden("You can only delete your own comments");
  }

  await db.update(priorityComments).set({ deletedAt: new Date() }).where(eq(priorityComments.id, commentId));

  res.json({ success: true });
}));

// ==================== GET /api/priorities/:id/watched ====================
router.get("/api/priorities/:id/watched", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const [watch] = await db
    .select({ userId: priorityWatches.userId })
    .from(priorityWatches)
    .where(and(eq(priorityWatches.priorityId, priorityId), eq(priorityWatches.userId, user.id)));

  res.json({ watching: !!watch });
}));

// ==================== POST /api/priorities/:id/watch ====================
router.post("/api/priorities/:id/watch", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  const [priority] = await db.select({ id: mytoolCompanyPriorities.id }).from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
  if (!priority) throw notFound("Priority");

  // ON CONFLICT DO NOTHING via upsert — idempotent
  await db.insert(priorityWatches)
    .values({ userId: user.id, priorityId })
    .onConflictDoNothing();

  res.json({ watching: true });
}));

// ==================== DELETE /api/priorities/:id/watch ====================
router.delete("/api/priorities/:id/watch", requireAuth, requirePermission("company_priorities", "view"), asyncHandler(async (req: Request, res: Response) => {
  const user = getEffectiveUser(req);
  if (!user?.id) throw badRequest("No effective user");
  const priorityId = parseIdParam(req.params.id);
  if (priorityId === null) throw badRequest("Invalid priority id");

  await db.delete(priorityWatches)
    .where(and(eq(priorityWatches.priorityId, priorityId), eq(priorityWatches.userId, user.id)));

  res.json({ watching: false });
}));

export function registerPriorityStrategicRoutes(app: any) {
  app.use(router);
}
