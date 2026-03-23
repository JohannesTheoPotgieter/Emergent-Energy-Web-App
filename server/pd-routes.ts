// @ts-nocheck
import type { Express, Request, Response } from "express";
import { db } from "./db";
import { clients, pdTickets, workItems, projectInfo, users, taskActivityLog, PD_REQUEST_TYPE_TASK_TEMPLATES, projectExecutionState, projectPdPmHandover, projectHandoverHistory } from "@shared/schema";
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
      let taskCounts: Record<number, { total: number; completed: number }> = {};
      if (ticketIds.length > 0) {
        const taskCountRows = await db
          .select({
            pdTicketId: workItems.pdTicketId,
            total: sql<number>`count(*)::int`,
            completed: sql<number>`count(*) FILTER (WHERE ${workItems.status} IN ('Completed', 'DONE', 'Done'))::int`,
          })
          .from(workItems)
          .where(sql`${workItems.pdTicketId} IS NOT NULL AND ${workItems.deletedAt} IS NULL`)
          .groupBy(workItems.pdTicketId);
        for (const row of taskCountRows) {
          if (row.pdTicketId) {
            taskCounts[row.pdTicketId] = { total: row.total, completed: row.completed };
          }
        }
      }

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
        const engineeringRequestTypes = new Set([
          "Feasibility Study", "Design Review", "IFC Planning",
          "Grid Application", "Battery Assessment", "Site Assessment", "Full EPC",
        ]);
        // Engineers see tickets where they are assigned to spawned work items or the ticket is engineering-related
        const engineerWorkItemTicketIds = await db
          .select({ pdTicketId: workItems.pdTicketId })
          .from(workItems)
          .where(and(
            eq(workItems.ownerUserId, user?.id),
            sql`${workItems.pdTicketId} IS NOT NULL`,
            sql`${workItems.deletedAt} IS NULL`,
          ));
        const assignedTicketIds = new Set(engineerWorkItemTicketIds.map(r => r.pdTicketId));
        result = enriched.filter(r =>
          assignedTicketIds.has(r.ticket.id) ||
          r.ticket.designerUserId === user?.id ||
          engineeringRequestTypes.has(r.ticket.requestType)
        );
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

      const tasks = await db
        .select({
          id: workItems.id,
          title: workItems.title,
          status: workItems.status,
          priority: workItems.priority,
          endDate: workItems.endDate,
          percentComplete: workItems.percentComplete,
          ownerUserId: workItems.ownerUserId,
          ownerName: workItems.ownerName,
          holdReason: workItems.holdReason,
          blockedType: workItems.blockedType,
          updatedAt: workItems.updatedAt,
        })
        .from(workItems)
        .where(and(eq(workItems.pdTicketId, id), sql`${workItems.deletedAt} IS NULL`))
        .orderBy(asc(workItems.sortOrder));

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
        estimatedProjectValue: body.estimatedProjectValue || null,
        estimatedCost: body.estimatedCost || null,
        estimatedMargin: body.estimatedMargin || null,
        estimatedMarginPercent: body.estimatedMarginPercent || null,
        financialNotes: body.financialNotes || null,
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
        "estimatedProjectValue", "estimatedCost", "estimatedMargin",
        "estimatedMarginPercent", "financialNotes",
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

  app.get("/api/pd/pipeline", requireAuth, async (req: Request, res: Response) => {
    try {
      const allTickets = await db
        .select({
          ticket: pdTickets,
          clientName: clients.name,
          projectName: projectInfo.projectName,
          developerName: sql<string>`(SELECT name FROM users WHERE id = ${pdTickets.projectDeveloperUserId})`,
        })
        .from(pdTickets)
        .leftJoin(clients, eq(pdTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(pdTickets.projectId, projectInfo.id))
        .orderBy(desc(pdTickets.createdAt));

      const handoverRows = await db
        .select({
          projectId: projectPdPmHandover.projectId,
          status: projectPdPmHandover.status,
          handoverReadinessStatus: projectPdPmHandover.handoverReadinessStatus,
        })
        .from(projectPdPmHandover);
      const handoverMap = new Map(handoverRows.map(h => [h.projectId, h]));

      const taskCountRows = await db
        .select({
          pdTicketId: workItems.pdTicketId,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${workItems.status} IN ('Completed', 'DONE', 'Done'))::int`,
        })
        .from(workItems)
        .where(sql`${workItems.pdTicketId} IS NOT NULL AND ${workItems.deletedAt} IS NULL`)
        .groupBy(workItems.pdTicketId);
      const taskCountMap = new Map(taskCountRows.map(r => [r.pdTicketId!, { total: r.total, completed: r.completed }]));

      const today = new Date().toISOString().split("T")[0];
      const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0];
      const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

      // By ticket status
      const byStatus: Record<string, { count: number; tickets: any[] }> = {};
      // By request type
      const byRequestType: Record<string, number> = {};
      // Overdue severity
      const overdue = { week: [] as any[], twoWeeks: [] as any[], month: [] as any[] };

      const enrichedTickets = allTickets.map(row => {
        const t = row.ticket;
        const handover = t.projectId ? handoverMap.get(t.projectId) : null;
        const tasks = taskCountMap.get(t.id) || { total: 0, completed: 0 };
        // Map to Kanban column
        let kanbanColumn = "New";
        if (t.status === "Draft") kanbanColumn = "New";
        else if (t.status === "In Progress") kanbanColumn = "In Progress";
        else if (t.status === "On Hold") kanbanColumn = "In Progress";
        else if (t.status === "Completed" || t.status === "Cancelled") {
          kanbanColumn = handover?.status === "ACCEPTED" ? "Handed Over" : "Handed Over";
          if (t.status === "Completed" && !handover) kanbanColumn = "Handed Over";
        }
        if (handover?.status === "SUBMITTED_FOR_PM_REVIEW") kanbanColumn = "Under Review";
        if (handover?.handoverReadinessStatus === "READY_FOR_HANDOVER" && handover?.status === "DRAFT") kanbanColumn = "Ready for Handover";
        if (handover?.status === "ACCEPTED") kanbanColumn = "Handed Over";

        const daysInStage = Math.max(0, Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / 86400000));
        const isOverdue = t.dueDate && t.dueDate < today && t.status !== "Completed" && t.status !== "Cancelled";

        const enriched = {
          id: t.id,
          projectSiteName: t.projectSiteName,
          clientName: row.clientName || t.clientNameSnapshot || null,
          projectName: row.projectName || t.projectSiteName,
          requestType: t.requestType,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
          developerName: row.developerName,
          kanbanColumn,
          daysInStage,
          isOverdue,
          taskTotal: tasks.total,
          taskCompleted: tasks.completed,
          handoverStatus: handover?.status || null,
          createdAt: t.createdAt,
        };

        // Aggregate by status
        if (!byStatus[kanbanColumn]) byStatus[kanbanColumn] = { count: 0, tickets: [] };
        byStatus[kanbanColumn].count++;
        byStatus[kanbanColumn].tickets.push(enriched);

        // Aggregate by request type
        byRequestType[t.requestType] = (byRequestType[t.requestType] || 0) + (t.status !== "Completed" && t.status !== "Cancelled" ? 1 : 0);

        // Overdue buckets
        if (isOverdue) {
          if (t.dueDate! >= oneWeekAgo) overdue.week.push(enriched);
          else if (t.dueDate! >= twoWeeksAgo) overdue.twoWeeks.push(enriched);
          else overdue.month.push(enriched);
        }

        return enriched;
      });

      // Handover status summary
      const handoverSummary = {
        notStarted: handoverRows.filter(h => !h.status || h.status === "DRAFT").length,
        draft: handoverRows.filter(h => h.status === "DRAFT").length,
        submitted: handoverRows.filter(h => h.status === "SUBMITTED_FOR_PM_REVIEW").length,
        accepted: handoverRows.filter(h => h.status === "ACCEPTED").length,
        rejected: handoverRows.filter(h => h.status === "REJECTED").length,
      };

      // Pipeline value from financial estimates
      const activeTicketsRaw = allTickets.map(r => r.ticket);
      const totalPipelineValue = activeTicketsRaw
        .filter(t => t.status !== "Completed" && t.status !== "Cancelled" && t.estimatedProjectValue)
        .reduce((sum, t) => sum + parseFloat(t.estimatedProjectValue as string || "0"), 0);

      res.json({
        tickets: enrichedTickets,
        byStatus,
        byRequestType,
        overdue,
        handoverSummary,
        totalPipelineValue,
        kanbanColumns: ["New", "In Progress", "Under Review", "Ready for Handover", "Handed Over"],
      });
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

  app.get("/api/pd/reports", requireAuth, async (req: Request, res: Response) => {
    try {
      // FY boundaries: Sep-Aug. FY2026 = 1 Sep 2025 → 31 Aug 2026
      const fyParam = req.query.fy ? parseInt(req.query.fy as string) : null;
      const now = new Date();
      const currentFY = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear(); // Month 8 = Sep
      const fy = fyParam || currentFY;
      const fyStart = new Date(`${fy - 1}-09-01T00:00:00Z`);
      const fyEnd = new Date(`${fy}-08-31T23:59:59Z`);

      // Quarter boundaries within FY (Sep-Nov, Dec-Feb, Mar-May, Jun-Aug)
      const quarters = [
        { label: "Q1", start: new Date(`${fy - 1}-09-01`), end: new Date(`${fy - 1}-11-30`) },
        { label: "Q2", start: new Date(`${fy - 1}-12-01`), end: new Date(`${fy}-02-28`) },
        { label: "Q3", start: new Date(`${fy}-03-01`), end: new Date(`${fy}-05-31`) },
        { label: "Q4", start: new Date(`${fy}-06-01`), end: new Date(`${fy}-08-31`) },
      ];

      const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM

      // Get all tickets
      const allTickets = await db.select().from(pdTickets);
      const fyTickets = allTickets.filter(t => t.createdAt >= fyStart && t.createdAt <= fyEnd);

      // Get all handovers
      const allHandovers = await db.select().from(projectPdPmHandover);
      const fyHandovers = allHandovers.filter(h => h.createdAt >= fyStart && h.createdAt <= fyEnd);

      // Get handover history for rejection reasons
      const handoverHistory = await db.select().from(projectHandoverHistory)
        .where(sql`${projectHandoverHistory.gateId} = 'PD_PM_HANDOVER'`);

      // Get users for workload
      const pdUsers = await db.select({ id: users.id, name: users.name }).from(users);
      const userMap = new Map(pdUsers.map(u => [u.id, u.name]));

      // --- Throughput Metrics ---
      const thisMonthTickets = fyTickets.filter(t => t.createdAt.toISOString().slice(0, 7) === currentMonth);
      const completedFy = fyTickets.filter(t => t.status === "Completed");
      const completedThisMonth = completedFy.filter(t => t.updatedAt.toISOString().slice(0, 7) === currentMonth);

      // Average cycle time by request type
      const cycleTimeByType: Record<string, { total: number; count: number }> = {};
      for (const t of completedFy) {
        const days = Math.max(0, Math.floor((t.updatedAt.getTime() - t.createdAt.getTime()) / 86400000));
        if (!cycleTimeByType[t.requestType]) cycleTimeByType[t.requestType] = { total: 0, count: 0 };
        cycleTimeByType[t.requestType].total += days;
        cycleTimeByType[t.requestType].count++;
      }
      const avgCycleTimeByType = Object.fromEntries(
        Object.entries(cycleTimeByType).map(([k, v]) => [k, Math.round(v.total / v.count)])
      );

      // Average handover cycle time (draft → accepted)
      const acceptedHandovers = allHandovers.filter(h => h.status === "ACCEPTED" && h.acceptedAt && h.createdAt);
      const avgHandoverCycleTime = acceptedHandovers.length > 0
        ? Math.round(acceptedHandovers.reduce((sum, h) => sum + Math.max(0, Math.floor((h.acceptedAt!.getTime() - h.createdAt.getTime()) / 86400000)), 0) / acceptedHandovers.length)
        : null;

      // Quarterly breakdown
      const quarterlyData = quarters.map(q => {
        const created = fyTickets.filter(t => t.createdAt >= q.start && t.createdAt <= q.end).length;
        const completed = completedFy.filter(t => t.updatedAt >= q.start && t.updatedAt <= q.end).length;
        const submitted = fyHandovers.filter(h => h.submittedAt && h.submittedAt >= q.start && h.submittedAt <= q.end).length;
        return { quarter: q.label, created, completed, submitted };
      });

      // --- Pipeline Health ---
      const activeByStatus: Record<string, number> = {};
      const activeByType: Record<string, number> = {};
      for (const t of allTickets) {
        if (t.status !== "Completed" && t.status !== "Cancelled") {
          activeByStatus[t.status] = (activeByStatus[t.status] || 0) + 1;
          activeByType[t.requestType] = (activeByType[t.requestType] || 0) + 1;
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const overdueCount = allTickets.filter(t => t.dueDate && t.dueDate < today && t.status !== "Completed" && t.status !== "Cancelled").length;

      // Tickets per PD team member
      const ticketsPerMember: Record<string, number> = {};
      for (const t of allTickets.filter(t => t.status !== "Completed" && t.status !== "Cancelled")) {
        const name = t.projectDeveloperUserId ? (userMap.get(t.projectDeveloperUserId) || "Unassigned") : "Unassigned";
        ticketsPerMember[name] = (ticketsPerMember[name] || 0) + 1;
      }

      // --- Handover Metrics ---
      const submittedHandovers = allHandovers.filter(h => h.submittedAt);
      const accepted = allHandovers.filter(h => h.status === "ACCEPTED").length;
      const rejected = allHandovers.filter(h => h.status === "REJECTED").length;
      const rejectionRate = (accepted + rejected) > 0 ? Math.round((rejected / (accepted + rejected)) * 100) : 0;

      // Average time from submission to decision
      const decidedHandovers = allHandovers.filter(h => h.submittedAt && (h.acceptedAt || h.rejectedAt));
      const avgDecisionTime = decidedHandovers.length > 0
        ? Math.round(decidedHandovers.reduce((sum, h) => {
            const decisionDate = h.acceptedAt || h.rejectedAt!;
            return sum + Math.max(0, Math.floor((decisionDate.getTime() - h.submittedAt!.getTime()) / 86400000));
          }, 0) / decidedHandovers.length)
        : null;

      // Top rejection reasons
      const rejectionReasons: Record<string, number> = {};
      const rejectedHistory = handoverHistory.filter(h => h.action === "PD_PM_HANDOVER_REJECTED");
      for (const h of rejectedHistory) {
        const details = h.details as any;
        const reason = details?.reason || "No reason specified";
        const shortReason = reason.length > 80 ? reason.slice(0, 80) + "..." : reason;
        rejectionReasons[shortReason] = (rejectionReasons[shortReason] || 0) + 1;
      }

      // --- Cross-functional demand ---
      const engineeringTypes = new Set(["Feasibility Study", "Design Review", "IFC Planning", "Grid Application", "Battery Assessment", "Site Assessment", "Full EPC"]);
      const engineeringTickets = allTickets.filter(t => engineeringTypes.has(t.requestType) && t.status !== "Cancelled").length;

      res.json({
        fy,
        fyLabel: `FY${fy} (Sep ${fy - 1} – Aug ${fy})`,
        throughput: {
          createdThisMonth: thisMonthTickets.length,
          createdFY: fyTickets.length,
          completedThisMonth: completedThisMonth.length,
          completedFY: completedFy.length,
          avgCycleTimeByType,
          avgHandoverCycleTimeDays: avgHandoverCycleTime,
          quarterly: quarterlyData,
        },
        pipelineHealth: {
          activeByStatus,
          activeByType,
          overdueCount,
          ticketsPerMember,
        },
        handover: {
          submitted: submittedHandovers.length,
          accepted,
          rejected,
          rejectionRate,
          avgDecisionTimeDays: avgDecisionTime,
          topRejectionReasons: Object.entries(rejectionReasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count })),
        },
        crossFunctional: {
          engineeringRequests: engineeringTickets,
        },
      });
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
      pdTicketId: ticket.id,
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
