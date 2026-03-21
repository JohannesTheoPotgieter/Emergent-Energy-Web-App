// @ts-nocheck
import type { Express, Request, Response } from "express";
import { db } from "./db";
import { clients, pdTickets, workItems, projectInfo, users, taskActivityLog, PD_REQUEST_TYPE_TASK_TEMPLATES, projectExecutionState } from "@shared/schema";
import { eq, ilike, sql, and, desc, asc, or, count } from "drizzle-orm";
import { getFeatureFlag } from "./lib/feature-flags";
import { requirePermission } from "./permission-middleware";

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function isPdRole(role: string): boolean {
  return ["PROJECT_DEVELOPER", "KEY_ACCOUNTS_MANAGER", "COO_ADMIN", "CEO_ADMIN", "CCO", "admin"].includes(role);
}

function canCreatePdTicket(role: string): boolean {
  return ["PROJECT_DEVELOPER", "COO_ADMIN", "CEO_ADMIN", "admin"].includes(role);
}

function canViewAllTickets(role: string): boolean {
  return ["COO_ADMIN", "CEO_ADMIN", "CCO", "admin"].includes(role);
}

export function registerPdRoutes(app: Express) {

  app.get("/api/pd/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      const search = (req.query.search as string) || "";
      let query;
      if (search) {
        query = db.select().from(clients).where(ilike(clients.name, `%${search}%`)).orderBy(asc(clients.name)).limit(50);
      } else {
        query = db.select().from(clients).orderBy(asc(clients.name)).limit(100);
      }
      const rows = await query;
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/pd/clients", requireAuth, requirePermission('pd_clients', 'create'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      if (!isPdRole(role)) {
        return res.status(403).json({ error: "Only Project Developers or Admins can create clients" });
      }

      const { name } = req.body;
      if (!name?.trim()) {
        return res.status(400).json({ error: "Client name is required" });
      }

      const existing = await db.select().from(clients).where(ilike(clients.name, name.trim())).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "Client with this name already exists", client: existing[0] });
      }

      const clientId = await generateClientId();

      const [created] = await db.insert(clients).values({
        clientId,
        name: name.trim(),
        createdBy: user?.id || null,
      }).returning();

      const dualWriteEnabled = await getFeatureFlag("promoted_core_clients_dual_write");
      const promotedMirror = { attempted: false, success: false, error: null as string | null };
      if (dualWriteEnabled) {
        promotedMirror.attempted = true;
        try {
          await db.execute(sql`
            INSERT INTO core.clients (id, legacy_id, client_code, name, created_by, updated_by, created_at, updated_at, source_table)
            VALUES (${created.id}, ${created.id}, ${clientId}, ${created.name}, ${user?.id ?? null}, ${user?.id ?? null}, NOW(), NOW(), 'public.clients')
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                client_code = EXCLUDED.client_code,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
          `);
          promotedMirror.success = true;
        } catch (mirrorError: any) {
          promotedMirror.error = mirrorError?.message || "unknown_error";
          console.error("[dual-write][pd-clients] promoted mirror write failed", mirrorError);
        }
      }

      if (promotedMirror.attempted) {
        res.setHeader("X-Promoted-Clients-Dual-Write", promotedMirror.success ? "mirrored" : "mirror_failed");
      }
      res.status(201).json({ ...created, _promotedMirror: promotedMirror });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/pd/clients/:id", requireAuth, requirePermission('pd_clients', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      if (!isPdRole(role)) {
        return res.status(403).json({ error: "Only authorized roles can edit clients" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid client ID" });

      const { name } = req.body;
      if (!name?.trim()) {
        return res.status(400).json({ error: "Client name is required" });
      }

      const [existing] = await db.select().from(clients).where(eq(clients.id, id));
      if (!existing) return res.status(404).json({ error: "Client not found" });

      const duplicate = await db.select().from(clients).where(and(ilike(clients.name, name.trim()), sql`${clients.id} != ${id}`)).limit(1);
      if (duplicate.length > 0) {
        return res.status(409).json({ error: "Another client with this name already exists" });
      }

      const [updated] = await db.update(clients).set({
        name: name.trim(),
        updatedBy: user?.id || null,
        updatedAt: new Date(),
      }).where(eq(clients.id, id)).returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd/clients/project-counts", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select({
        clientId: projectInfo.clientId,
        count: sql<number>`count(*)::int`,
      })
        .from(projectInfo)
        .where(sql`${projectInfo.clientId} IS NOT NULL`)
        .groupBy(projectInfo.clientId);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd/tickets", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";

      const rows = await db
        .select({
          ticket: pdTickets,
          clientName: clients.name,
          projectName: projectInfo.projectName,
          developerName: sql<string>`(SELECT name FROM users WHERE id = ${pdTickets.projectDeveloperUserId})`,
          designerName: sql<string>`(SELECT name FROM users WHERE id = ${pdTickets.designerUserId})`,
        })
        .from(pdTickets)
        .leftJoin(clients, eq(pdTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(pdTickets.projectId, projectInfo.id))
        .orderBy(desc(pdTickets.createdAt));

      const ticketIds = rows.map(r => r.ticket.id);
      // PD ticket task counts: pdTicketId was on operational_tasks which is being dropped.
      // Work items don't carry pdTicketId; returning empty counts until PD-ticket linkage is re-modelled.
      let taskCounts: Record<number, { total: number; completed: number }> = {};

      const enriched = rows.map(r => ({
        ...r,
        clientName: r.clientName || r.ticket.clientNameSnapshot || null,
        projectName: r.projectName || r.ticket.projectSiteName || null,
        taskTotal: taskCounts[r.ticket.id]?.total || 0,
        taskCompleted: taskCounts[r.ticket.id]?.completed || 0,
      }));

      let result;
      if (canViewAllTickets(role)) {
        result = enriched;
      } else if (role === "PROJECT_DEVELOPER") {
        result = enriched.filter(r => r.ticket.createdBy === user?.id || r.ticket.projectDeveloperUserId === user?.id);
      } else if (role === "ENGINEER") {
        // PD ticket → task linkage via pdTicketId no longer available (operational_tasks dropped).
        // Engineers see no PD tickets until linkage is re-modelled on work_items.
        result = [];
      } else {
        result = enriched;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd/tickets/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ticket ID" });

      const [ticket] = await db
        .select({
          ticket: pdTickets,
          clientName: clients.name,
          clientClientId: clients.clientId,
          projectName: projectInfo.projectName,
          projectPhase: projectExecutionState.phase,
        })
        .from(pdTickets)
        .leftJoin(clients, eq(pdTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(pdTickets.projectId, projectInfo.id))
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(eq(pdTickets.id, id));

      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      // PD ticket → task linkage via pdTicketId no longer available (operational_tasks dropped).
      // Returning empty task list until PD-ticket linkage is re-modelled on work_items.
      const tasks: any[] = [];

      const taskIds = tasks.map(t => t.id);
      let recentActivity: any[] = [];
      if (taskIds.length > 0) {
        recentActivity = await db.select().from(taskActivityLog)
          .where(sql`${taskActivityLog.workItemId} IN (${sql.raw(taskIds.join(","))})`)
          .orderBy(desc(taskActivityLog.createdAt))
          .limit(20);
      }

      const developerUser = ticket.ticket.projectDeveloperUserId
        ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, ticket.ticket.projectDeveloperUserId)).limit(1)
        : [];
      const designerUser = ticket.ticket.designerUserId
        ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, ticket.ticket.designerUserId)).limit(1)
        : [];

      res.json({
        ...ticket,
        clientName: ticket.clientName || ticket.ticket.clientNameSnapshot || null,
        projectName: ticket.projectName || ticket.ticket.projectSiteName || null,
        tasks,
        recentActivity,
        developerName: developerUser[0]?.name || null,
        designerName: designerUser[0]?.name || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/pd/tickets", requireAuth, requirePermission('pd_quality', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      if (!canCreatePdTicket(role)) {
        return res.status(403).json({ error: "Only Project Developers can create PD tickets" });
      }

      const body = req.body;
      if (!body.projectSiteName?.trim()) {
        return res.status(400).json({ error: "Project/Site Name is required" });
      }
      if (!body.requestType) {
        return res.status(400).json({ error: "Request Type is required" });
      }
      if (!body.projectId) {
        return res.status(400).json({ error: "Project linkage is required. Please link this ticket to a project for lifecycle tracking." });
      }
      if (!body.dueDate) {
        return res.status(400).json({ error: "Due date is required for SLA tracking." });
      }

      const [ticket] = await db.insert(pdTickets).values({
        clientId: body.clientId || null,
        clientNameSnapshot: body.clientNameSnapshot || null,
        projectId: body.projectId || null,
        projectSiteName: body.projectSiteName.trim(),
        dueDate: body.dueDate || null,
        requestType: body.requestType,
        priority: body.priority || "Medium",
        status: body.status || "Draft",
        numberOfReworks: body.numberOfReworks || 0,
        projectDeveloperUserId: body.projectDeveloperUserId || user?.id || null,
        designerUserId: body.designerUserId || null,
        fundingType: body.fundingType || null,
        sizeKwp: body.sizeKwp || null,
        province: body.province || null,
        gpsCoordinates: body.gpsCoordinates || null,
        billsOrTariffData: body.billsOrTariffData || false,
        meteringDataAvailable: body.meteringDataAvailable || false,
        siteInspectionForm: body.siteInspectionForm || false,
        siteInspectionLink: body.siteInspectionLink || null,
        workingSchedule: body.workingSchedule || null,
        batteriesNeeded: body.batteriesNeeded || false,
        batterySize: body.batterySize || null,
        dieselGenIntegration: body.dieselGenIntegration || false,
        roofReplacementNeeded: body.roofReplacementNeeded || false,
        hseDiscussed: body.hseDiscussed || false,
        comments: body.comments || null,
        createdBy: user?.id || null,
      }).returning();

      const selectedTasks: string[] | undefined = body.selectedTasks;
      await spawnTasksForTicket(ticket, user, selectedTasks);

      res.status(201).json(ticket);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/pd/tickets/:id", requireAuth, requirePermission('pd_quality', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ticket ID" });

      const [existing] = await db.select().from(pdTickets).where(eq(pdTickets.id, id));
      if (!existing) return res.status(404).json({ error: "Ticket not found" });

      if (!canViewAllTickets(role) && existing.createdBy !== user?.id && existing.projectDeveloperUserId !== user?.id) {
        return res.status(403).json({ error: "Not authorized to edit this ticket" });
      }

      const updates: Record<string, any> = { updatedAt: new Date() };
      const allowedFields = [
        "clientId", "clientNameSnapshot", "projectId", "projectSiteName",
        "dueDate", "requestType", "priority", "status", "numberOfReworks",
        "projectDeveloperUserId", "designerUserId", "fundingType", "sizeKwp",
        "province", "gpsCoordinates", "billsOrTariffData", "meteringDataAvailable",
        "siteInspectionForm", "siteInspectionLink", "workingSchedule",
        "batteriesNeeded", "batterySize", "dieselGenIntegration",
        "roofReplacementNeeded", "hseDiscussed", "comments",
      ];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const [updated] = await db.update(pdTickets).set(updates).where(eq(pdTickets.id, id)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/pd/tickets/:id/spawn-tasks", requireAuth, requirePermission('pd_quality', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      if (!canCreatePdTicket(role)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const id = parseInt(req.params.id);
      const [ticket] = await db.select().from(pdTickets).where(eq(pdTickets.id, id));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      if (ticket.tasksSpawnedAt) {
        return res.status(409).json({ error: "Tasks already spawned for this ticket" });
      }

      const spawned = await spawnTasksForTicket(ticket, user);
      res.json({ spawned: spawned.length, tasks: spawned });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const allTickets = await db.select().from(pdTickets);
      const today = new Date().toISOString().split("T")[0];

      const total = allTickets.length;
      const active = allTickets.filter(t => t.status === "In Progress" || t.status === "Draft").length;
      const overdue = allTickets.filter(t => t.dueDate && t.dueDate < today && t.status !== "Completed" && t.status !== "Cancelled").length;
      const dueThisWeek = allTickets.filter(t => {
        if (!t.dueDate || t.status === "Completed" || t.status === "Cancelled") return false;
        const d = new Date(t.dueDate);
        const now = new Date();
        const weekEnd = new Date();
        weekEnd.setDate(now.getDate() + 7);
        return d >= now && d <= weekEnd;
      }).length;
      const onHold = allTickets.filter(t => t.status === "On Hold").length;
      const completed = allTickets.filter(t => t.status === "Completed").length;

      res.json({ total, active, overdue, dueThisWeek, onHold, completed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd/users", requireAuth, async (_req: Request, res: Response) => {
    try {
      const allUsers = await db.select({ id: users.id, name: users.name, role: users.companyRole })
        .from(users)
        .orderBy(asc(users.name));
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pd/projects/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const search = (req.query.search as string) || "";
      let query;
      if (search) {
        query = db.select({ id: projectInfo.id, projectName: projectInfo.projectName, phase: projectExecutionState.phase, pd: projectInfo.pd })
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
          .where(ilike(projectInfo.projectName, `%${search}%`))
          .orderBy(asc(projectInfo.projectName))
          .limit(20);
      } else {
        query = db.select({ id: projectInfo.id, projectName: projectInfo.projectName, phase: projectExecutionState.phase, pd: projectInfo.pd })
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
          .orderBy(asc(projectInfo.projectName))
          .limit(50);
      }
      const rows = await query;
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

async function generateClientId(): Promise<string> {
  const [result] = await db.select({ cnt: count() }).from(clients);
  const num = (result?.cnt || 0) as number;
  const nextNum = num + 1;
  return `EE-C${String(nextNum).padStart(4, "0")}`;
}

async function spawnTasksForTicket(ticket: any, user: any, selectedTasks?: string[]): Promise<any[]> {
  if (ticket.tasksSpawnedAt) return [];

  let templates = PD_REQUEST_TYPE_TASK_TEMPLATES[ticket.requestType] || [];
  if (templates.length === 0) return [];

  if (selectedTasks && Array.isArray(selectedTasks)) {
    const selectedSet = new Set(selectedTasks);
    templates = templates.filter(t => selectedSet.has(t.title));
    if (templates.length === 0) {
      await db.update(pdTickets)
        .set({ tasksSpawnedAt: new Date(), status: ticket.status === "Draft" ? "In Progress" : ticket.status })
        .where(eq(pdTickets.id, ticket.id));
      return [];
    }
  }

  let projectName = ticket.projectSiteName || "Unassigned";
  if (ticket.projectId) {
    const [proj] = await db.select({ projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(eq(projectInfo.id, ticket.projectId));
    if (proj) projectName = proj.projectName;
  }

  const spawned: any[] = [];
  for (let i = 0; i < templates.length; i++) {
    const tmpl = templates[i];
    if (!ticket.projectId) continue; // workItems requires a projectId
    const [task] = await db.insert(workItems).values({
      projectId: ticket.projectId,
      workstream: "ENG",
      source: "UI",
      title: `[PD] ${tmpl.title}`,
      description: `Auto-spawned from PD Ticket #${ticket.id} (${ticket.requestType}) for ${ticket.projectSiteName}`,
      status: "TO DO",
      priority: tmpl.priority === "High" ? "High" : "Medium",
      endDate: ticket.dueDate || null,
      sortOrder: i,
      createdBy: user?.id || null,
    }).returning();

    if (task) {
      await db.insert(taskActivityLog).values({
        workItemId: task.id,
        actorId: user?.id || null,
        actionType: "created",
        newValue: `Task auto-spawned from PD Ticket #${ticket.id} (${ticket.requestType})`,
      });
      spawned.push(task);
    }
  }

  await db.update(pdTickets)
    .set({ tasksSpawnedAt: new Date(), status: ticket.status === "Draft" ? "In Progress" : ticket.status })
    .where(eq(pdTickets.id, ticket.id));

  return spawned;
}
