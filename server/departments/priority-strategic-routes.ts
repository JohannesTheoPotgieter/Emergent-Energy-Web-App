import { Router, type Request, type Response } from "express";
import { requireAuth, requirePriorityAdmin } from "./shared-middleware";
import { getEffectiveUser } from "../auth-context";
import { db } from "../db";
import {
  mytoolCompanyPriorities,
  priorityProjects,
  users,
  projectInfo,
  projectExecutionState,
  derivedProjectKpis,
  workItems,
  approvals,
} from "@shared/schema";
import { eq, and, sql, desc, asc, inArray, isNull, ne } from "drizzle-orm";
import { PRIORITY_HEALTH_VALUES, type PriorityHealth, computeEffectivePriorityHealth } from "@shared/kpi-definitions";
import { PRIORITY_SCOPES, ESCALATION_REASONS, type PriorityScope } from "@shared/config/priorities";

const router = Router();

// ==================== HELPERS ====================

const COO_ONLY_ROLES = ["COO_ADMIN", "CEO_ADMIN"];

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

function requireCooOnly(req: Request, res: Response, next: any) {
  const role = getEffectiveUser(req)?.role;
  if (role && COO_ONLY_ROLES.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "COO access required" });
}

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
  healthReasons: string[];
  projectCount: number;
  atRiskProjectCount: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  blockerCount: number;
  openTaskCount: number;
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

async function getUserById(userId: number): Promise<{ id: number; name: string } | null> {
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return user || null;
}

async function getUsersByIds(userIds: number[]): Promise<Map<number, { id: number; name: string }>> {
  if (userIds.length === 0) return new Map();
  const rows: Array<{ id: number; name: string }> = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
  return new Map(rows.map((u) => [u.id, u]));
}

async function enrichPriority(
  priority: any,
  metrics: DerivedMetricsRow | null,
  userMap?: Map<number, { id: number; name: string }>,
  parentMap?: Map<number, string>,
  childCountMap?: Map<number, number>,
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
    targetStartDate: priority.targetStartDate ?? priority.target_start_date,
    targetOutcome: priority.targetOutcome ?? priority.target_outcome,
    accountableExecId: priority.accountableExecId ?? priority.accountable_exec_id,
    ownerUserId: priority.ownerUserId ?? priority.owner_user_id,
    priorityRank: priority.priorityRank ?? priority.priority_rank,
    horizon: priority.horizon,
    // Cascade fields
    scope: (priority.scope ?? 'company') as PriorityScope,
    parentId: priority.parentId ?? priority.parent_id ?? null,
    departmentKey: priority.departmentKey ?? priority.department_key ?? null,
    assignedUserId: priority.assignedUserId ?? priority.assigned_user_id ?? null,
    escalated: priority.escalated ?? false,
    escalatedAt: priority.escalatedAt ?? priority.escalated_at ?? null,
    escalationReason: priority.escalationReason ?? priority.escalation_reason ?? null,
    createdAt: priority.createdAt ?? priority.created_at,
    updatedAt: priority.updatedAt ?? priority.updated_at,
  };

  const projectCount = Number(metrics?.project_count || 0);
  const hasProjects = projectCount > 0;
  const blockerCount = Number(metrics?.blocker_count || 0);

  const derivedHealth = hasProjects ? (metrics?.derived_health ?? null) : null;
  const manualHealth = (p.manualHealth as PriorityHealth | null) || null;

  const { health: effectiveHealth, reasons: healthReasons } = computeEffectivePriorityHealth({
    manualHealth,
    derivedHealth,
    severity: p.severity,
    dueDate: p.dueDate,
    status: p.status,
    blockerCount,
  });

  const effectiveProgress = hasProjects
    ? Math.round(Number(metrics?.avg_progress || 0))
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
    healthReasons,
    projectCount,
    atRiskProjectCount: Number(metrics?.at_risk_project_count || 0),
    totalRevenue: Number(metrics?.total_revenue || 0),
    totalCos: Number(metrics?.total_cos || 0),
    totalGp: Number(metrics?.total_gp || 0),
    blockerCount,
    openTaskCount: Number(metrics?.open_task_count || 0),
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
router.get("/api/priorities", requireAuth, async (req: Request, res: Response) => {
  try {
    const includeCancelled = req.query.include_cancelled === "true";
    const scopeFilter = req.query.scope as string | undefined;
    const departmentFilter = req.query.department as string | undefined;
    const assignedUserIdFilter = req.query.assigned_user_id as string | undefined;
    const parentIdFilter = req.query.parent_id as string | undefined;
    const escalatedOnly = req.query.escalated_only === "true";

    // Fetch all priorities
    let allPriorities: any[];
    try {
      allPriorities = await db.select().from(mytoolCompanyPriorities);
    } catch (dbErr: any) {
      console.error("[Priorities] DB query failed:", dbErr.message);
      try {
        const raw: any = await db.execute(sql`SELECT * FROM mytool_company_priorities ORDER BY id`);
        allPriorities = raw.rows || raw || [];
      } catch (rawErr: any) {
        console.error("[Priorities] Raw SQL fallback also failed:", rawErr.message);
        return res.status(500).json({ error: "Database query failed", detail: (dbErr as Error).message });
      }
    }

    // Filter out cancelled unless requested
    if (!includeCancelled) {
      allPriorities = allPriorities.filter((p: any) => p.status !== "closed");
    }

    // Apply scope filter (defaults to 'company' for backward compatibility)
    if (scopeFilter && PRIORITY_SCOPES.includes(scopeFilter as PriorityScope)) {
      allPriorities = allPriorities.filter((p: any) => (p.scope ?? 'company') === scopeFilter);
    } else if (!scopeFilter) {
      // Default: show company scope (backward compatible)
      allPriorities = allPriorities.filter((p: any) => (p.scope ?? 'company') === 'company');
    }

    // Apply department filter
    if (departmentFilter) {
      allPriorities = allPriorities.filter((p: any) =>
        (p.departmentKey ?? p.department_key) === departmentFilter
      );
    }

    // Apply assigned user filter — 'me' resolves to the current user
    if (assignedUserIdFilter) {
      const targetUserId = assignedUserIdFilter === "me"
        ? getEffectiveUser(req)?.id
        : parseInt(assignedUserIdFilter);
      if (targetUserId) {
        allPriorities = allPriorities.filter((p: any) =>
          (p.assignedUserId ?? p.assigned_user_id) === targetUserId
          || (p.ownerUserId ?? p.owner_user_id) === targetUserId
        );
      }
    }

    // Apply parent filter
    if (parentIdFilter) {
      const parentId = parseInt(parentIdFilter);
      allPriorities = allPriorities.filter((p: any) => (p.parentId ?? p.parent_id) === parentId);
    }

    // Apply escalation filter
    if (escalatedOnly) {
      allPriorities = allPriorities.filter((p: any) => p.escalated === true);
    }

    // Get all derived metrics
    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

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
    const childCountResult: any = await db.execute(sql`
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM mytool_company_priorities
      WHERE parent_id IS NOT NULL AND status != 'closed'
      GROUP BY parent_id
    `);
    const childCountMap = new Map<number, number>();
    for (const row of (childCountResult.rows || childCountResult || [])) {
      childCountMap.set(row.parent_id, row.child_count);
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
      allPriorities.map((p: any) => enrichPriority(p, metricsMap.get(p.id), userMap, parentMap, childCountMap))
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
  } catch (err: any) {
    console.error("[Priorities] List error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==================== GET /api/priorities/:id ====================
router.get("/api/priorities/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });
    const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (!priority) return res.status(404).json({ error: "Priority not found" });

    const metrics = await getPriorityDerivedMetrics(priorityId);
    const enriched = await enrichPriority(priority, metrics);

    // Fetch linked projects with details
    const linkedProjects = await db
      .select({
        id: projectInfo.id,
        name: projectInfo.projectName,
        phase: projectExecutionState.phase,
        ragStatus: projectExecutionState.ragStatus,
        pmUserId: projectInfo.pmUserId,
        pmName: projectInfo.pm,
        linkedAt: priorityProjects.linkedAt,
        percentComplete: derivedProjectKpis.avgActualPctComplete,
        totalRevenue: derivedProjectKpis.totalPlannedRevenue,
        totalCos: derivedProjectKpis.totalPlannedExpenses,
        grossProfit: derivedProjectKpis.grossProfit,
        grossMarginPct: derivedProjectKpis.grossMarginPct,
        revenueRealised: derivedProjectKpis.revenueRealised,
        cosRealised: derivedProjectKpis.cosRealised,
      })
      .from(priorityProjects)
      .innerJoin(projectInfo, eq(priorityProjects.projectId, projectInfo.id))
      .leftJoin(projectExecutionState, eq(projectInfo.id, projectExecutionState.projectId))
      .leftJoin(derivedProjectKpis, eq(projectInfo.id, derivedProjectKpis.projectId))
      .where(eq(priorityProjects.priorityId, priorityId));

    // Get PM user objects for linked projects
    const projectsWithPm = await Promise.all(linkedProjects.map(async (p: typeof linkedProjects[number]) => {
      const pm = p.pmUserId ? await getUserById(p.pmUserId) : null;
      return {
        id: p.id,
        name: p.name,
        phase: p.phase,
        ragStatus: p.ragStatus,
        pm: pm || (p.pmName ? { id: 0, name: p.pmName } : null),
        percentComplete: Math.round(Number(p.percentComplete || 0)),
        linkedAt: p.linkedAt,
        totalRevenue: Number(p.totalRevenue || 0),
        totalCos: Number(p.totalCos || 0),
        grossProfit: Number(p.grossProfit || 0),
        grossMarginPct: Number(p.grossMarginPct || 0),
        revenueRealised: Number(p.revenueRealised || 0),
        cosRealised: Number(p.cosRealised || 0),
      };
    }));

    res.json({ ...enriched, linkedProjects: projectsWithPm });
  } catch (err: any) {
    console.error("[Priorities] Detail error:", err);
    throw err;
  }
});

// ==================== POST /api/priorities ====================
router.post("/api/priorities", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const {
      title, description, severity, department, owner_user_id, accountable_exec_id,
      target_start_date, due_date, target_outcome, sort_order,
      manual_health, manual_progress, project_ids, owner_role, assigned_to,
      horizon, next_action, definition_of_done, support,
      // Cascade fields
      scope, parent_id, department_key, assigned_user_id,
    } = req.body;

    if (!title) return res.status(400).json({ error: "title is required" });

    // Validate scope
    if (scope && !PRIORITY_SCOPES.includes(scope)) {
      return res.status(400).json({ error: "scope must be one of: company, department, role" });
    }

    // Validate severity
    const validSeverities = ["critical", "important", "normal"];
    if (severity && !validSeverities.includes(severity)) {
      return res.status(400).json({ error: "severity must be one of: critical, important, normal" });
    }

    // Validate manual_health
    if (manual_health && !(PRIORITY_HEALTH_VALUES as readonly string[]).includes(manual_health)) {
      return res.status(400).json({ error: "manual_health must be one of: healthy, at_risk, critical" });
    }

    // Validate manual_progress
    if (manual_progress != null && (manual_progress < 0 || manual_progress > 100)) {
      return res.status(400).json({ error: "manual_progress must be between 0 and 100" });
    }

    // Validate owner_user_id exists
    if (owner_user_id) {
      const ownerUser = await getUserById(owner_user_id);
      if (!ownerUser) return res.status(400).json({ error: "owner_user_id not found" });
    }

    // Validate accountable_exec_id exists
    if (accountable_exec_id) {
      const execUser = await getUserById(accountable_exec_id);
      if (!execUser) return res.status(400).json({ error: "accountable_exec_id not found" });
    }

    // Validate assigned_user_id exists
    if (assigned_user_id) {
      const assignee = await getUserById(assigned_user_id);
      if (!assignee) return res.status(400).json({ error: "assigned_user_id not found" });
    }

    // Validate parent_id exists
    if (parent_id) {
      const [parent] = await db.select({ id: mytoolCompanyPriorities.id }).from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, parent_id));
      if (!parent) return res.status(400).json({ error: "parent_id not found" });
    }

    // Validate project_ids exist
    if (project_ids && project_ids.length > 0) {
      const projects = await db.select({ id: projectInfo.id }).from(projectInfo).where(inArray(projectInfo.id, project_ids));
      if (projects.length !== project_ids.length) {
        return res.status(400).json({ error: "One or more project_ids not found" });
      }
    }

    const now = new Date();
    const [created] = await db.insert(mytoolCompanyPriorities).values({
      title,
      description: description || null,
      severity: severity || "normal",
      department: department || null,
      ownerUserId: owner_user_id || null,
      accountableExecId: accountable_exec_id || null,
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
      // Cascade fields
      scope: scope || "company",
      parentId: parent_id || null,
      departmentKey: department_key || null,
      assignedUserId: assigned_user_id || null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Create junction table rows
    if (project_ids && project_ids.length > 0) {
      await db.insert(priorityProjects).values(
        project_ids.map((pid: number) => ({
          priorityId: created.id,
          projectId: pid,
          linkedBy: user.id,
        }))
      );
    }

    // Return enriched detail
    const metrics = await getPriorityDerivedMetrics(created.id);
    const enriched = await enrichPriority(created, metrics);
    res.status(201).json(enriched);
  } catch (err: any) {
    console.error("[Priorities] Create error:", err);
    throw err;
  }
});

// ==================== PUT /api/priorities/:id ====================
router.put("/api/priorities/:id", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });

    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) return res.status(404).json({ error: "Priority not found" });

    const {
      title, description, severity, department, owner_user_id, accountable_exec_id,
      target_start_date, due_date, target_outcome, sort_order,
      manual_health, manual_progress, project_ids, owner_role, assigned_to,
      status, horizon, next_action, definition_of_done, support, priority_rank,
      // Cascade fields
      scope, parent_id, department_key, assigned_user_id,
    } = req.body;

    // Validate severity
    if (severity && !["critical", "important", "normal"].includes(severity)) {
      return res.status(400).json({ error: "severity must be one of: critical, important, normal" });
    }

    // Validate manual_health
    if (manual_health !== undefined && manual_health !== null && !(PRIORITY_HEALTH_VALUES as readonly string[]).includes(manual_health)) {
      return res.status(400).json({ error: "manual_health must be one of: healthy, at_risk, critical" });
    }

    // Validate scope
    if (scope !== undefined && !PRIORITY_SCOPES.includes(scope)) {
      return res.status(400).json({ error: "scope must be one of: company, department, role" });
    }

    // Build update object
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
    // Cascade fields
    if (scope !== undefined) updates.scope = scope;
    if (parent_id !== undefined) updates.parentId = parent_id;
    if (department_key !== undefined) updates.departmentKey = department_key;
    if (assigned_user_id !== undefined) updates.assignedUserId = assigned_user_id;

    const [updated] = await db.update(mytoolCompanyPriorities)
      .set(updates)
      .where(eq(mytoolCompanyPriorities.id, priorityId))
      .returning();

    // Sync junction table if project_ids provided
    if (project_ids !== undefined) {
      const currentLinks = await db.select().from(priorityProjects)
        .where(eq(priorityProjects.priorityId, priorityId));
      const currentProjectIds = new Set(currentLinks.map((l: typeof currentLinks[number]) => l.projectId));
      const newProjectIds = new Set(project_ids as number[]);

      // Delete removed links
      const toDelete = currentLinks.filter((l: typeof currentLinks[number]) => !newProjectIds.has(l.projectId));
      for (const link of toDelete) {
        await db.delete(priorityProjects).where(eq(priorityProjects.id, link.id));
      }

      // Insert new links
      const toInsert = (project_ids as number[]).filter(pid => !currentProjectIds.has(pid));
      if (toInsert.length > 0) {
        await db.insert(priorityProjects).values(
          toInsert.map(pid => ({
            priorityId,
            projectId: pid,
            linkedBy: user.id,
          }))
        );
      }
    }

    // Return enriched detail
    const metrics = await getPriorityDerivedMetrics(priorityId);
    const enriched = await enrichPriority(updated, metrics);
    res.json(enriched);
  } catch (err: any) {
    console.error("[Priorities] Update error:", err);
    throw err;
  }
});

// ==================== DELETE /api/priorities/:id ====================
router.delete("/api/priorities/:id", requireAuth, requireCooOnly, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });
    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) return res.status(404).json({ error: "Priority not found" });

    // Soft delete: set status to 'closed'
    await db.update(mytoolCompanyPriorities)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(mytoolCompanyPriorities.id, priorityId));

    res.status(204).send();
  } catch (err: any) {
    console.error("[Priorities] Delete error:", err);
    throw err;
  }
});

// ==================== POST /api/priorities/:id/projects ====================
router.post("/api/priorities/:id/projects", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });
    const { project_ids } = req.body;

    if (!project_ids || !Array.isArray(project_ids) || project_ids.length === 0) {
      return res.status(400).json({ error: "project_ids array is required" });
    }

    // Validate priority exists
    const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (!priority) return res.status(404).json({ error: "Priority not found" });

    // Validate all project_ids exist
    const projects = await db.select({ id: projectInfo.id }).from(projectInfo).where(inArray(projectInfo.id, project_ids));
    if (projects.length !== project_ids.length) {
      return res.status(400).json({ error: "One or more project_ids not found" });
    }

    // Upsert: insert ignore duplicates
    for (const pid of project_ids) {
      try {
        await db.insert(priorityProjects).values({
          priorityId,
          projectId: pid,
          linkedBy: user.id,
        }).onConflictDoNothing();
      } catch (_) {
        // Ignore duplicate constraint violations
      }
    }

    // Return updated linked projects
    const linkedProjects = await db
      .select({
        id: projectInfo.id,
        name: projectInfo.projectName,
        phase: projectExecutionState.phase,
        ragStatus: projectExecutionState.ragStatus,
        pmName: projectInfo.pm,
        linkedAt: priorityProjects.linkedAt,
      })
      .from(priorityProjects)
      .innerJoin(projectInfo, eq(priorityProjects.projectId, projectInfo.id))
      .leftJoin(projectExecutionState, eq(projectInfo.id, projectExecutionState.projectId))
      .where(eq(priorityProjects.priorityId, priorityId));

    res.json(linkedProjects);
  } catch (err: any) {
    console.error("[Priorities] Link projects error:", err);
    throw err;
  }
});

// ==================== DELETE /api/priorities/:id/projects/:projectId ====================
router.delete("/api/priorities/:id/projects/:projectId", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    const projectId = parseIdParam(req.params.projectId);
    if (priorityId === null || projectId === null) return res.status(400).json({ error: "Invalid id parameter" });

    await db.delete(priorityProjects).where(
      and(
        eq(priorityProjects.priorityId, priorityId),
        eq(priorityProjects.projectId, projectId),
      )
    );

    res.status(204).send();
  } catch (err: any) {
    console.error("[Priorities] Unlink project error:", err);
    throw err;
  }
});

// ==================== GET /api/projects/:id/priorities ====================
router.get("/api/projects/:id/priorities", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = parseIdParam(req.params.id);
    if (projectId === null) return res.status(400).json({ error: "Invalid project id" });

    const priorities = await db
      .select({
        id: mytoolCompanyPriorities.id,
        title: mytoolCompanyPriorities.title,
        severity: mytoolCompanyPriorities.severity,
        manualHealth: mytoolCompanyPriorities.manualHealth,
        status: mytoolCompanyPriorities.status,
        dueDate: mytoolCompanyPriorities.dueDate,
      })
      .from(priorityProjects)
      .innerJoin(mytoolCompanyPriorities, eq(priorityProjects.priorityId, mytoolCompanyPriorities.id))
      .where(eq(priorityProjects.projectId, projectId));

    // Compute effective health for each using the shared rule engine
    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

    const result = priorities.map((p: typeof priorities[number]) => {
      const metrics = metricsMap.get(p.id);
      const projectCount = Number(metrics?.project_count || 0);
      const { health: effectiveHealth } = computeEffectivePriorityHealth({
        manualHealth: p.manualHealth as PriorityHealth | null,
        derivedHealth: projectCount > 0 ? (metrics?.derived_health ?? null) : null,
        severity: p.severity,
        dueDate: p.dueDate,
        status: p.status,
        blockerCount: Number(metrics?.blocker_count || 0),
      });

      return {
        id: p.id,
        title: p.title,
        severity: p.severity,
        effectiveHealth,
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error("[Priorities] Project priorities error:", err);
    throw err;
  }
});

// ==================== GET /api/priorities/:id/tasks ====================
router.get("/api/priorities/:id/tasks", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });

    // Get linked project IDs
    const links = await db.select({ projectId: priorityProjects.projectId })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));

    if (links.length === 0) return res.json([]);

    const projectIds = links.map((l: typeof links[number]) => l.projectId);

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
  } catch (err: any) {
    console.error("[Priorities] Tasks error:", err);
    throw err;
  }
});

// ==================== GET /api/priorities/:id/approvals ====================
router.get("/api/priorities/:id/approvals", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });

    const links = await db.select({ projectId: priorityProjects.projectId })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));

    if (links.length === 0) return res.json([]);

    const projectIds = links.map((l: typeof links[number]) => l.projectId);

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
  } catch (err: any) {
    console.error("[Priorities] Approvals error:", err);
    throw err;
  }
});

// ==================== GET /api/priorities/:id/updates ====================
router.get("/api/priorities/:id/updates", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });

    const links = await db.select({ projectId: priorityProjects.projectId })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));

    if (links.length === 0) return res.json([]);

    const projectIds = links.map((l: typeof links[number]) => l.projectId);

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
  } catch (err: any) {
    console.error("[Priorities] Updates error:", err);
    throw err;
  }
});

// ==================== POST /api/priorities/:id/escalate ====================
router.post("/api/priorities/:id/escalate", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });
    const { reason } = req.body;

    if (reason && !ESCALATION_REASONS.includes(reason)) {
      return res.status(400).json({ error: "reason must be one of: overdue, critical, blocked, manual" });
    }

    const [priority] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (!priority) return res.status(404).json({ error: "Priority not found" });

    const currentScope = priority.scope ?? "company";
    const escalationReason = reason || "manual";
    const now = new Date();

    if (currentScope === "company") {
      return res.status(400).json({ error: "Company-level priorities cannot be escalated further" });
    }

    // Determine the next scope up
    const nextScope: PriorityScope = currentScope === "role" ? "department" : "company";

    // Mark current priority as escalated
    await db.update(mytoolCompanyPriorities)
      .set({ escalated: true, escalatedAt: now, escalationReason, updatedAt: now })
      .where(eq(mytoolCompanyPriorities.id, priorityId));

    // Create the parent priority at the next level up (if no parent exists)
    if (!priority.parentId) {
      const [parent] = await db.insert(mytoolCompanyPriorities).values({
        title: priority.title,
        description: priority.description,
        severity: priority.severity,
        department: priority.department,
        dueDate: priority.dueDate,
        ownerUserId: priority.ownerUserId,
        ownerRole: priority.ownerRole,
        assignedTo: priority.assignedTo,
        horizon: priority.horizon || "quarter",
        manualHealth: priority.manualHealth,
        manualProgress: priority.manualProgress,
        scope: nextScope,
        departmentKey: nextScope === "department" ? priority.departmentKey : null,
        escalated: true,
        escalatedAt: now,
        escalationReason,
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Link child to new parent
      await db.update(mytoolCompanyPriorities)
        .set({ parentId: parent.id, updatedAt: now })
        .where(eq(mytoolCompanyPriorities.id, priorityId));

      const metrics = await getPriorityDerivedMetrics(parent.id);
      const enriched = await enrichPriority(parent, metrics);
      return res.status(201).json(enriched);
    }

    // Parent already exists — just mark escalation
    const [updated] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    const metrics = await getPriorityDerivedMetrics(priorityId);
    const enriched = await enrichPriority(updated, metrics);
    res.json(enriched);
  } catch (err: any) {
    console.error("[Priorities] Escalate error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==================== GET /api/priorities/:id/children ====================
router.get("/api/priorities/:id/children", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseIdParam(req.params.id);
    if (priorityId === null) return res.status(400).json({ error: "Invalid priority id" });

    const children = await db.select().from(mytoolCompanyPriorities)
      .where(and(
        eq(mytoolCompanyPriorities.parentId, priorityId),
        ne(mytoolCompanyPriorities.status, "closed"),
      ));

    if (children.length === 0) return res.json([]);

    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

    const userIds = Array.from(new Set(
      children.flatMap((p: any) => [p.ownerUserId, p.accountableExecId, p.assignedUserId].filter(Boolean)),
    )) as number[];
    const userMap = await getUsersByIds(userIds);

    // Get grandchild counts
    const childIds = children.map((c: typeof children[number]) => c.id);
    const grandChildResult: any = await db.execute(sql`
      SELECT parent_id, COUNT(*)::int AS child_count
      FROM mytool_company_priorities
      WHERE parent_id = ANY(${childIds}) AND status != 'closed'
      GROUP BY parent_id
    `);
    const grandChildCountMap = new Map<number, number>();
    for (const row of (grandChildResult.rows || grandChildResult || [])) {
      grandChildCountMap.set(row.parent_id, row.child_count);
    }

    const enriched = await Promise.all(
      children.map((p: any) => enrichPriority(p, metricsMap.get(p.id), userMap, new Map(), grandChildCountMap))
    );

    // Group by department for display
    enriched.sort((a, b) => {
      const deptA = a.departmentKey || "";
      const deptB = b.departmentKey || "";
      if (deptA !== deptB) return deptA.localeCompare(deptB);
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });

    res.json(enriched);
  } catch (err: any) {
    console.error("[Priorities] Children error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==================== POST /api/priorities/:id/break-down ====================
// Creates child priorities from a parent — used by COO to push down to departments
router.post("/api/priorities/:id/break-down", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const parentId = parseIdParam(req.params.id);
    if (parentId === null) return res.status(400).json({ error: "Invalid parent id" });
    const { children } = req.body;

    if (!children || !Array.isArray(children) || children.length === 0) {
      return res.status(400).json({ error: "children array is required" });
    }

    const [parent] = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, parentId));
    if (!parent) return res.status(404).json({ error: "Parent priority not found" });

    const currentScope = parent.scope ?? "company";
    const childScope: PriorityScope = currentScope === "company" ? "department" : "role";

    const now = new Date();
    const created = [];
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
    }

    res.status(201).json(created);
  } catch (err: any) {
    console.error("[Priorities] Break-down error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export function registerPriorityStrategicRoutes(app: any) {
  app.use(router);
}
