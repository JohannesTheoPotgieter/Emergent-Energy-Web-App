import type { Express, Request, Response } from "express";
import { db } from "./db";
import { clients, pdTickets, operationalTasks, projectInfo, users, taskActivityLog, PD_REQUEST_TYPE_TASK_TEMPLATES } from "@shared/schema";
import { eq, ilike, sql, and, desc, asc, or, count } from "drizzle-orm";

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function isPdRole(role: string): boolean {
  return ["PROJECT_DEVELOPER", "COO_ADMIN", "CEO_ADMIN", "CCO", "admin"].includes(role);
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

  app.post("/api/pd/clients", requireAuth, async (req: Request, res: Response) => {
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

      res.status(201).json(created);
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
      let taskCounts: Record<number, { total: number; completed: number }> = {};
      if (ticketIds.length > 0) {
        const taskStats = await db.select({
          pdTicketId: operationalTasks.pdTicketId,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${operationalTasks.status} = 'COMPLETE')::int`,
        })
          .from(operationalTasks)
          .where(sql`${operationalTasks.pdTicketId} IN (${sql.raw(ticketIds.join(","))})`)
          .groupBy(operationalTasks.pdTicketId);
        for (const s of taskStats) {
          if (s.pdTicketId) taskCounts[s.pdTicketId] = { total: s.total, completed: s.completed };
        }
      }

      const enriched = rows.map(r => ({
        ...r,
        clientName: r.clientName || r.ticket.clientNameSnapshot || null,
        projectName: r.projectName || (r.ticket.projectId ? r.ticket.projectSiteName : null),
        taskTotal: taskCounts[r.ticket.id]?.total || 0,
        taskCompleted: taskCounts[r.ticket.id]?.completed || 0,
      }));

      let result;
      if (canViewAllTickets(role)) {
        result = enriched;
      } else if (role === "PROJECT_DEVELOPER") {
        result = enriched.filter(r => r.ticket.createdBy === user?.id || r.ticket.projectDeveloperUserId === user?.id);
      } else if (role === "ENGINEER") {
        const engTaskLinks = await db.select({ pdTicketId: operationalTasks.pdTicketId })
          .from(operationalTasks)
          .where(
            and(
              sql`${operationalTasks.pdTicketId} IS NOT NULL`,
              sql`${operationalTasks.assignees}::text ILIKE ${'%' + (user?.name || '') + '%'}`
            )
          );
        const engTicketIds = new Set(engTaskLinks.map(t => t.pdTicketId).filter(Boolean));
        result = enriched.filter(r => engTicketIds.has(r.ticket.id));
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
          projectPhase: projectInfo.phase,
        })
        .from(pdTickets)
        .leftJoin(clients, eq(pdTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(pdTickets.projectId, projectInfo.id))
        .where(eq(pdTickets.id, id));

      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      const tasks = await db.select().from(operationalTasks)
        .where(eq(operationalTasks.pdTicketId, id))
        .orderBy(asc(operationalTasks.sortOrder), asc(operationalTasks.id));

      const taskIds = tasks.map(t => t.id);
      let recentActivity: any[] = [];
      if (taskIds.length > 0) {
        recentActivity = await db.select().from(taskActivityLog)
          .where(sql`${taskActivityLog.taskId} IN (${sql.raw(taskIds.join(","))})`)
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
        projectName: ticket.projectName || (ticket.ticket.projectId ? ticket.ticket.projectSiteName : null),
        tasks,
        recentActivity,
        developerName: developerUser[0]?.name || null,
        designerName: designerUser[0]?.name || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/pd/tickets", requireAuth, async (req: Request, res: Response) => {
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

      await spawnTasksForTicket(ticket, user);

      res.status(201).json(ticket);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/pd/tickets/:id", requireAuth, async (req: Request, res: Response) => {
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

  app.post("/api/pd/tickets/:id/spawn-tasks", requireAuth, async (req: Request, res: Response) => {
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
        query = db.select({ id: projectInfo.id, projectName: projectInfo.projectName, phase: projectInfo.phase, pd: projectInfo.pd })
          .from(projectInfo)
          .where(ilike(projectInfo.projectName, `%${search}%`))
          .orderBy(asc(projectInfo.projectName))
          .limit(20);
      } else {
        query = db.select({ id: projectInfo.id, projectName: projectInfo.projectName, phase: projectInfo.phase, pd: projectInfo.pd })
          .from(projectInfo)
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

async function spawnTasksForTicket(ticket: any, user: any): Promise<any[]> {
  if (ticket.tasksSpawnedAt) return [];

  const templates = PD_REQUEST_TYPE_TASK_TEMPLATES[ticket.requestType] || [];
  if (templates.length === 0) return [];

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
    const [task] = await db.insert(operationalTasks).values({
      projectId: ticket.projectId,
      projectName,
      title: `[PD] ${tmpl.title}`,
      description: `Auto-spawned from PD Ticket #${ticket.id} (${ticket.requestType}) for ${ticket.projectSiteName}`,
      status: "TO DO",
      priority: tmpl.priority === "High" ? "High" : "Medium",
      dueDate: ticket.dueDate || null,
      pdTicketId: ticket.id,
      sortOrder: i,
      createdBy: user?.id || null,
      domain: "BOTH",
    }).returning();

    if (task) {
      await db.insert(taskActivityLog).values({
        taskId: task.id,
        userId: user?.id || null,
        action: "created",
        details: `Task auto-spawned from PD Ticket #${ticket.id} (${ticket.requestType})`,
      });
      spawned.push(task);
    }
  }

  await db.update(pdTickets)
    .set({ tasksSpawnedAt: new Date(), status: ticket.status === "Draft" ? "In Progress" : ticket.status })
    .where(eq(pdTickets.id, ticket.id));

  return spawned;
}
