// @ts-nocheck
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
  dashboardProjectMetrics,
} from "@shared/schema";
import { eq, and, sql, desc, asc, inArray, not, isNull, or, ilike } from "drizzle-orm";

const router = Router();

// ==================== HELPERS ====================

const ADMIN_ROLES = ["admin", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];
const COO_ONLY_ROLES = ["admin", "COO_ADMIN", "CEO_ADMIN"];

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
  createdAt: Date;
  updatedAt: Date;
  // Derived
  owner: { id: number; name: string } | null;
  accountableExec: { id: number; name: string } | null;
  effectiveHealth: string;
  effectiveProgress: number;
  projectCount: number;
  atRiskProjectCount: number;
  totalRevenue: number;
  totalCos: number;
  totalGp: number;
  blockerCount: number;
  openTaskCount: number;
  hasProjects: boolean;
}

async function getPriorityDerivedMetrics(priorityId: number) {
  const rows = await db.execute(sql`
    SELECT * FROM priority_derived_metrics WHERE priority_id = ${priorityId}
  `);
  return rows.rows?.[0] || rows[0] || null;
}

async function getAllPriorityDerivedMetrics() {
  const rows = await db.execute(sql`SELECT * FROM priority_derived_metrics`);
  return (rows.rows || rows) as any[];
}

async function getUserById(userId: number) {
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return user || null;
}

async function enrichPriority(priority: any, metrics: any): Promise<PriorityWithMetrics> {
  const projectCount = Number(metrics?.project_count || 0);
  const hasProjects = projectCount > 0;

  const effectiveHealth = hasProjects
    ? (metrics?.derived_health || "healthy")
    : (priority.manualHealth || "healthy");

  const effectiveProgress = hasProjects
    ? Math.round(Number(metrics?.avg_progress || 0))
    : (priority.manualProgress || 0);

  const owner = priority.ownerUserId ? await getUserById(priority.ownerUserId) : null;
  const accountableExec = priority.accountableExecId ? await getUserById(priority.accountableExecId) : null;

  return {
    id: priority.id,
    title: priority.title,
    description: priority.description,
    department: priority.department,
    severity: priority.severity,
    status: priority.status,
    dueDate: priority.dueDate,
    assignedTo: priority.assignedTo,
    ownerRole: priority.ownerRole,
    sortOrder: priority.sortOrder || 0,
    manualHealth: priority.manualHealth,
    manualProgress: priority.manualProgress,
    targetStartDate: priority.targetStartDate,
    targetOutcome: priority.targetOutcome,
    accountableExecId: priority.accountableExecId,
    ownerUserId: priority.ownerUserId,
    priorityRank: priority.priorityRank,
    horizon: priority.horizon,
    createdAt: priority.createdAt,
    updatedAt: priority.updatedAt,
    owner,
    accountableExec,
    effectiveHealth,
    effectiveProgress,
    projectCount,
    atRiskProjectCount: Number(metrics?.at_risk_project_count || 0),
    totalRevenue: Number(metrics?.total_revenue || 0),
    totalCos: Number(metrics?.total_cos || 0),
    totalGp: Number(metrics?.total_gp || 0),
    blockerCount: Number(metrics?.blocker_count || 0),
    openTaskCount: Number(metrics?.open_task_count || 0),
    hasProjects,
  };
}

// ==================== GET /api/priorities ====================
router.get("/api/priorities", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const includeCancelled = req.query.include_cancelled === "true";

    // Fetch all priorities
    let allPriorities = await db.select().from(mytoolCompanyPriorities);

    // Filter out cancelled unless requested
    if (!includeCancelled) {
      allPriorities = allPriorities.filter(p => p.status !== "closed");
    }

    // Get all derived metrics
    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

    // Role filtering
    const isFullAccess = ADMIN_ROLES.includes(user.role);
    if (!isFullAccess) {
      // Get projects assigned to this user
      const userProjects = await db.select({ id: projectInfo.id })
        .from(projectInfo)
        .where(or(
          eq(projectInfo.pmUserId, user.id),
          eq(projectInfo.pdUserId, user.id),
        ));
      const userProjectIds = new Set(userProjects.map(p => p.id));

      // Get priority-project links
      const allLinks = await db.select().from(priorityProjects);
      const priorityProjectMap = new Map<number, number[]>();
      for (const link of allLinks) {
        if (!priorityProjectMap.has(link.priorityId)) priorityProjectMap.set(link.priorityId, []);
        priorityProjectMap.get(link.priorityId)!.push(link.projectId);
      }

      allPriorities = allPriorities.filter(p => {
        const linkedProjectIds = priorityProjectMap.get(p.id) || [];
        if (linkedProjectIds.length === 0) {
          // Standalone: show if user is the owner
          return p.ownerUserId === user.id || p.assignedTo === user.name;
        }
        // Has projects: show if any linked project is assigned to user
        return linkedProjectIds.some(pid => userProjectIds.has(pid));
      });
    }

    // Enrich with metrics
    const enriched = await Promise.all(
      allPriorities.map(p => enrichPriority(p, metricsMap.get(p.id)))
    );

    // Sort: severity DESC (critical > important > normal), health DESC (critical > at_risk > healthy), dueDate ASC, sortOrder ASC
    const severityOrder: Record<string, number> = { critical: 0, important: 1, normal: 2 };
    const healthOrder: Record<string, number> = { critical: 0, at_risk: 1, healthy: 2 };
    enriched.sort((a, b) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET /api/priorities/:id ====================
router.get("/api/priorities/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseInt(req.params.id);
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
    const projectsWithPm = await Promise.all(linkedProjects.map(async (p) => {
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
    res.status(500).json({ error: err.message });
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
    } = req.body;

    if (!title) return res.status(400).json({ error: "title is required" });

    // Validate severity
    const validSeverities = ["critical", "important", "normal"];
    if (severity && !validSeverities.includes(severity)) {
      return res.status(400).json({ error: "severity must be one of: critical, important, normal" });
    }

    // Validate manual_health
    if (manual_health && !["healthy", "at_risk", "critical"].includes(manual_health)) {
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== PUT /api/priorities/:id ====================
router.put("/api/priorities/:id", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const priorityId = parseInt(req.params.id);

    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) return res.status(404).json({ error: "Priority not found" });

    const {
      title, description, severity, department, owner_user_id, accountable_exec_id,
      target_start_date, due_date, target_outcome, sort_order,
      manual_health, manual_progress, project_ids, owner_role, assigned_to,
      status, horizon, next_action, definition_of_done, support, priority_rank,
    } = req.body;

    // Validate severity
    if (severity && !["critical", "important", "normal"].includes(severity)) {
      return res.status(400).json({ error: "severity must be one of: critical, important, normal" });
    }

    // Validate manual_health
    if (manual_health !== undefined && manual_health !== null && !["healthy", "at_risk", "critical"].includes(manual_health)) {
      return res.status(400).json({ error: "manual_health must be one of: healthy, at_risk, critical" });
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

    const [updated] = await db.update(mytoolCompanyPriorities)
      .set(updates)
      .where(eq(mytoolCompanyPriorities.id, priorityId))
      .returning();

    // Sync junction table if project_ids provided
    if (project_ids !== undefined) {
      const currentLinks = await db.select().from(priorityProjects)
        .where(eq(priorityProjects.priorityId, priorityId));
      const currentProjectIds = new Set(currentLinks.map(l => l.projectId));
      const newProjectIds = new Set(project_ids as number[]);

      // Delete removed links
      const toDelete = currentLinks.filter(l => !newProjectIds.has(l.projectId));
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== DELETE /api/priorities/:id ====================
router.delete("/api/priorities/:id", requireAuth, requireCooOnly, async (req: Request, res: Response) => {
  try {
    const priorityId = parseInt(req.params.id);
    const existing = await db.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, priorityId));
    if (existing.length === 0) return res.status(404).json({ error: "Priority not found" });

    // Soft delete: set status to 'closed'
    await db.update(mytoolCompanyPriorities)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(mytoolCompanyPriorities.id, priorityId));

    res.status(204).send();
  } catch (err: any) {
    console.error("[Priorities] Delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== POST /api/priorities/:id/projects ====================
router.post("/api/priorities/:id/projects", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req)!;
    const priorityId = parseInt(req.params.id);
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== DELETE /api/priorities/:id/projects/:projectId ====================
router.delete("/api/priorities/:id/projects/:projectId", requireAuth, requirePriorityAdmin, async (req: Request, res: Response) => {
  try {
    const priorityId = parseInt(req.params.id);
    const projectId = parseInt(req.params.projectId);

    await db.delete(priorityProjects).where(
      and(
        eq(priorityProjects.priorityId, priorityId),
        eq(priorityProjects.projectId, projectId),
      )
    );

    res.status(204).send();
  } catch (err: any) {
    console.error("[Priorities] Unlink project error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET /api/projects/:id/priorities ====================
router.get("/api/projects/:id/priorities", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id);

    const priorities = await db
      .select({
        id: mytoolCompanyPriorities.id,
        title: mytoolCompanyPriorities.title,
        severity: mytoolCompanyPriorities.severity,
        manualHealth: mytoolCompanyPriorities.manualHealth,
        status: mytoolCompanyPriorities.status,
      })
      .from(priorityProjects)
      .innerJoin(mytoolCompanyPriorities, eq(priorityProjects.priorityId, mytoolCompanyPriorities.id))
      .where(eq(priorityProjects.projectId, projectId));

    // Compute effective health for each
    const allMetrics = await getAllPriorityDerivedMetrics();
    const metricsMap = new Map(allMetrics.map((m: any) => [m.priority_id, m]));

    const result = priorities.map(p => {
      const metrics = metricsMap.get(p.id);
      const projectCount = Number(metrics?.project_count || 0);
      const effectiveHealth = projectCount > 0
        ? (metrics?.derived_health || "healthy")
        : (p.manualHealth || "healthy");

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
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET /api/priorities/:id/tasks ====================
router.get("/api/priorities/:id/tasks", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseInt(req.params.id);

    // Get linked project IDs
    const links = await db.select({ projectId: priorityProjects.projectId })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));

    if (links.length === 0) return res.json([]);

    const projectIds = links.map(l => l.projectId);

    // Get project names for context
    const projects = await db.select({ id: projectInfo.id, name: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    const projectNameMap = new Map(projects.map(p => [p.id, p.name]));

    // Get tasks from linked projects
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
      ))
      .orderBy(asc(workItems.endDate));

    const result = tasks.map(t => ({
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
    result.sort((a, b) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET /api/priorities/:id/approvals ====================
router.get("/api/priorities/:id/approvals", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseInt(req.params.id);

    const links = await db.select({ projectId: priorityProjects.projectId })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));

    if (links.length === 0) return res.json([]);

    const projectIds = links.map(l => l.projectId);

    // Get project names
    const projects = await db.select({ id: projectInfo.id, name: projectInfo.projectName })
      .from(projectInfo)
      .where(inArray(projectInfo.id, projectIds));
    const projectNameMap = new Map(projects.map(p => [p.id, p.name]));

    const pendingApprovals = await db
      .select()
      .from(approvals)
      .where(and(
        inArray(approvals.projectId, projectIds),
        eq(approvals.status, "pending"),
      ))
      .orderBy(asc(approvals.dueDate));

    const result = pendingApprovals.map(a => ({
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET /api/priorities/:id/updates ====================
router.get("/api/priorities/:id/updates", requireAuth, async (req: Request, res: Response) => {
  try {
    const priorityId = parseInt(req.params.id);

    const links = await db.select({ projectId: priorityProjects.projectId })
      .from(priorityProjects)
      .where(eq(priorityProjects.priorityId, priorityId));

    if (links.length === 0) return res.json([]);

    const projectIds = links.map(l => l.projectId);

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
      .filter(p => p.ragComment || p.phaseNotes)
      .map(p => ({
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
    res.status(500).json({ error: err.message });
  }
});

export function registerPriorityStrategicRoutes(app: any) {
  app.use(router);
}
