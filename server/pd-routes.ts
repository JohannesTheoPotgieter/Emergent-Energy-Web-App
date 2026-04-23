// Error breakdown: TS7006 implicit-any: 30, TS2345 query/param types: 17, other: 3
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import type { Express, Request, Response } from "express";
import { db } from "./db";
import { clients, engineeringTickets, workItems, workItemAssignments, projectInfo, users, taskActivityLog, PD_REQUEST_TYPE_TASK_TEMPLATES, projectExecutionState, projectPdPmHandover, projectHandoverHistory, pdVisibilityConfig, workstreamVisibilityConfig, opportunities } from "@shared/schema";
import { eq, ilike, sql, and, desc, asc, or, isNull, inArray } from "drizzle-orm";
import { getFeatureFlag } from "./lib/feature-flags";
import { requirePermission } from "./permission-middleware";
import { getEffectiveWorkstreamVisibility } from "./workstream-visibility-middleware";

import { requireAuth } from "./auth-context";
import { canViewAllTickets, ENGINEERING_REQUEST_TYPES } from "@shared/roles/pd-roles";
import { paramStr } from "./lib/req-params";
import { insertClientWithGeneratedId } from "./lib/client-id-generator";
import { logAuditFromReq } from "./audit-logger";
import {
  ENGINEERING_TICKET_DEFAULT_STATUS,
  isTicketDoneForReporting,
  isTicketBlocked,
  normalizeEngineeringTicketStatus,
} from "@shared/engineering-ticket-status";

/**
 * Resolve the effective PD visibility config for a user.
 * Now delegates to the unified workstream visibility system, falling back
 * to the legacy pdVisibilityConfig table for backward compatibility.
 */
async function getEffectiveVisibilityConfig(userId: number | undefined, role: string) {
  // Try the new workstream visibility config first
  try {
    if (userId) {
      const [userConfig] = await db.select().from(workstreamVisibilityConfig)
        .where(eq(workstreamVisibilityConfig.userId, userId));
      if (userConfig) return userConfig;
    }
    if (role) {
      const [roleConfig] = await db.select().from(workstreamVisibilityConfig)
        .where(and(eq(workstreamVisibilityConfig.role, role), isNull(workstreamVisibilityConfig.userId)));
      if (roleConfig) return roleConfig;
    }
  } catch {
    // New table may not exist yet — fall back to legacy table
  }

  // Fall back to legacy pdVisibilityConfig
  if (userId) {
    const [userConfig] = await db.select().from(pdVisibilityConfig)
      .where(eq(pdVisibilityConfig.userId, userId));
    if (userConfig) return userConfig;
  }
  if (role) {
    const [roleConfig] = await db.select().from(pdVisibilityConfig)
      .where(and(eq(pdVisibilityConfig.role, role), isNull(pdVisibilityConfig.userId)));
    if (roleConfig) return roleConfig;
  }

  return null;
}

const engineeringRequestTypesSet = new Set<string>(ENGINEERING_REQUEST_TYPES as readonly string[]);

/**
 * Return today's date as a YYYY-MM-DD string in Africa/Johannesburg
 * (SAST / UTC+2, no DST). The PD dashboard compares this value to
 * `pd_tickets.due_date` which is stored as a calendar-day string. Using
 * the raw UTC date (`new Date().toISOString().split("T")[0]`) produced a
 * two-hour false-negative window every night between 00:00 and 02:00
 * SAST, during which tickets due "today" and due "yesterday" were not
 * correctly classified as overdue/upcoming. This helper eliminates that
 * drift without pulling in a full timezone library.
 */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
function todaySast(): string {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString().split("T")[0];
}
function sastDateNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000 + SAST_OFFSET_MS).toISOString().split("T")[0];
}

/**
 * Filter an array of PD ticket rows by the requesting user's role and
 * the configurable pdVisibilityConfig settings.
 *
 * When a visibility config exists (per-user or per-role), it controls:
 *   - ticketTypes: ["pd", "engineering"] — which request type categories to show
 *   - scope: "all" | "own" — whether to show all tickets or only the user's own
 *
 * When no config exists, the original hardcoded logic applies:
 *   - PD_VIEW_ALL_ROLES see everything
 *   - PROJECT_DEVELOPER sees own tickets only
 *   - ENGINEER sees engineering-type tickets + assigned tickets
 *   - Other roles see everything
 */
async function filterTicketsByRole<T extends Record<string, any>>(
  tickets: T[],
  user: any,
  role: string,
  engineerAssignedTicketIds?: Set<number>,
): Promise<T[]> {
  // Helper to read a field from either the top-level object or a nested `.ticket`
  const field = (row: T, key: string) => (row as any).ticket?.[key] ?? (row as any)[key];

  // Try to load a visibility config for this user/role
  const config = await getEffectiveVisibilityConfig(user?.id, role);

  if (config) {
    // Configurable path: apply ticketTypes + scope filters
    const allowedTypes = new Set(config.ticketTypes || ["pd", "engineering"]);
    const scopeAll = config.scope === "all";

    return tickets.filter(r => {
      const reqType = field(r, "requestType") || "";
      const isEngineering = engineeringRequestTypesSet.has(reqType);
      const ticketCategory = isEngineering ? "engineering" : "pd";

      // Ticket type filter
      if (!allowedTypes.has(ticketCategory)) return false;

      // Scope filter
      if (!scopeAll) {
        const isOwn =
          field(r, "createdBy") === user?.id ||
          field(r, "projectDeveloperUserId") === user?.id ||
          field(r, "designerUserId") === user?.id;
        if (!isOwn) return false;
      }

      return true;
    });
  }

  // --- Fallback: original hardcoded logic when no config exists ---
  if (canViewAllTickets(role)) return tickets;

  if (role === "PROJECT_DEVELOPER") {
    return tickets.filter(
      r => field(r, "createdBy") === user?.id || field(r, "projectDeveloperUserId") === user?.id,
    );
  }

  if (role === "ENGINEER") {
    let assignedIds = engineerAssignedTicketIds;
    if (!assignedIds) {
      const rows = await db
        .select({ pdTicketId: workItems.engineeringTicketId })
        .from(workItems)
        .where(
          and(
            eq(workItems.ownerUserId, user?.id),
            sql`${workItems.engineeringTicketId} IS NOT NULL`,
            sql`${workItems.deletedAt} IS NULL`,
          ),
        );
      assignedIds = new Set(rows.map((r: any) => r.pdTicketId).filter(Boolean) as number[]);
    }
    return tickets.filter(
      r =>
        assignedIds!.has(field(r, "id")) ||
        field(r, "designerUserId") === user?.id ||
        engineeringRequestTypesSet.has(field(r, "requestType")),
    );
  }

  // Other authenticated roles – return all (route-level auth already gates access)
  return tickets;
}

export function registerPdRoutes(app: Express) {

  app.get("/api/pd/clients", requireAuth, requirePermission('pd_clients', 'view'), async (req: Request, res: Response) => {
    try {
      const search = (req.query.search as string) || "";
      // Explicit column selection so this endpoint stays alive when a
      // Drizzle-schema column exists but the DB column has not been
      // migrated yet (email-domain columns from migration 0013 are a
      // recent addition — without explicit selection the `select()`
      // fails with "column does not exist" against an un-migrated DB).
      const baseCols = {
        id: clients.id,
        clientId: clients.clientId,
        name: clients.name,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
        createdBy: clients.createdBy,
        updatedBy: clients.updatedBy,
        legalEntityName: clients.legalEntityName,
        tradingName: clients.tradingName,
        clientType: clients.clientType,
        billingEntity: clients.billingEntity,
        primaryContactName: clients.primaryContactName,
        primaryContactEmail: clients.primaryContactEmail,
        primaryContactPhone: clients.primaryContactPhone,
        secondaryContactName: clients.secondaryContactName,
        secondaryContactEmail: clients.secondaryContactEmail,
        industry: clients.industry,
        pipedriveOrgId: clients.pipedriveOrgId,
        status: clients.status,
      };
      let rows;
      try {
        const full = {
          ...baseCols,
          primaryEmailDomain: clients.primaryEmailDomain,
          additionalEmailDomains: clients.additionalEmailDomains,
        };
        rows = search
          ? await db.select(full).from(clients).where(ilike(clients.name, `%${search}%`)).orderBy(asc(clients.name)).limit(50)
          : await db.select(full).from(clients).orderBy(asc(clients.name)).limit(100);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (/primary_email_domain|additional_email_domains|42703|does not exist/i.test(msg)) {
          console.warn("[pd-routes] clients: email-domain columns missing (migration 0013 not applied) — falling back to base columns");
          rows = search
            ? await db.select(baseCols).from(clients).where(ilike(clients.name, `%${search}%`)).orderBy(asc(clients.name)).limit(50)
            : await db.select(baseCols).from(clients).orderBy(asc(clients.name)).limit(100);
        } else {
          throw err;
        }
      }
      res.json(rows);
    } catch (err: any) {
      console.error("[pd-routes] list clients error:", err);
      res.status(500).json({ error: "Failed to load clients" });
    }
  });

  app.post("/api/pd/clients", requireAuth, requirePermission('pd_clients', 'create'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      // NOTE: the former `isPdRole(role)` double-gate was removed because
      // `requirePermission('pd_clients', 'create')` above already enforces
      // access via the authoritative ENTITY_PERMISSION_DEFAULTS table,
      // which exactly matches the hardcoded PD_ROLES list. Keeping two
      // sources of truth for the same decision led to silent drift.
      const { name } = req.body;
      if (!name?.trim()) {
        return res.status(400).json({ error: "Client name is required" });
      }

      const existing = await db.select().from(clients).where(ilike(clients.name, name.trim())).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "Client with this name already exists", client: existing[0] });
      }

      // Race-safe insert: helper holds a Postgres advisory lock around
      // the MAX+INSERT so concurrent create requests cannot collide on
      // the `EE-Cxxxx` sequence. See server/lib/client-id-generator.ts.
      const created = await insertClientWithGeneratedId({
        name: name.trim(),
        createdBy: user?.id || null,
      });
      const clientId = created.clientId;

      logAuditFromReq(req, {
        entityType: "client",
        entityId: String(created.id),
        action: "create",
        changesJson: { name: created.name, clientId: created.clientId },
      });

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
      throw err;
    }
  });

  app.patch("/api/pd/clients/:id", requireAuth, requirePermission('pd_clients', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      // NOTE: hardcoded `isPdRole` double-gate removed — see POST above.
      const id = parseInt(paramStr(req.params.id));
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
      throw err;
    }
  });

  app.get("/api/pd/clients/project-counts", requireAuth, requirePermission('pd_clients', 'view'), async (_req: Request, res: Response) => {
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
      throw err;
    }
  });

  app.get("/api/pd/tickets", requireAuth, requirePermission('pd_tickets', 'view'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";

      const rows = await db
        .select({
          ticket: engineeringTickets,
          clientName: clients.name,
          projectName: projectInfo.projectName,
          developerName: sql<string>`(SELECT name FROM users WHERE id = ${engineeringTickets.projectDeveloperUserId})`,
          designerName: sql<string>`(SELECT name FROM users WHERE id = ${engineeringTickets.designerUserId})`,
        })
        .from(engineeringTickets)
        .leftJoin(clients, eq(engineeringTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(engineeringTickets.projectId, projectInfo.id))
        // Cascade-display: hide soft-deleted PD tickets and tickets whose
        // project was soft-deleted (Task #34). For unlinked tickets
        // (projectId IS NULL), the joined project_info row is NULL and
        // the IS NULL check passes — they remain visible.
        .where(and(
          isNull(engineeringTickets.deletedAt),
          or(isNull(engineeringTickets.projectId), isNull(projectInfo.deletedAt)),
        ))
        .orderBy(desc(engineeringTickets.createdAt));

      const ticketIds = rows.map((r: any) => r.ticket.id);
      let taskCounts: Record<number, { total: number; completed: number }> = {};
      if (ticketIds.length > 0) {
        const taskCountRows = await db
          .select({
            pdTicketId: workItems.engineeringTicketId,
            total: sql<number>`count(*)::int`,
            completed: sql<number>`count(*) FILTER (WHERE ${workItems.status} IN ('Completed', 'DONE', 'Done'))::int`,
          })
          .from(workItems)
          .where(sql`${workItems.engineeringTicketId} IS NOT NULL AND ${workItems.deletedAt} IS NULL`)
          .groupBy(workItems.engineeringTicketId);
        for (const row of taskCountRows) {
          if (row.pdTicketId) {
            taskCounts[row.pdTicketId] = { total: row.total, completed: row.completed };
          }
        }
      }

      const enriched = rows.map((r: any) => ({
        ...r,
        clientName: r.clientName || r.ticket.clientNameSnapshot || null,
        projectName: r.projectName || r.ticket.projectSiteName || null,
        taskTotal: taskCounts[r.ticket.id]?.total || 0,
        taskCompleted: taskCounts[r.ticket.id]?.completed || 0,
      }));

      const result = await filterTicketsByRole(enriched, user, role);
      res.json(result);
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/pd/tickets/:id", requireAuth, requirePermission('pd_tickets', 'view'), async (req: Request, res: Response) => {
    try {
      const id = parseInt(paramStr(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ticket ID" });

      const [ticket] = await db
        .select({
          ticket: engineeringTickets,
          clientName: clients.name,
          clientClientId: clients.clientId,
          projectName: projectInfo.projectName,
          projectPhase: projectExecutionState.phase,
        })
        .from(engineeringTickets)
        .leftJoin(clients, eq(engineeringTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(engineeringTickets.projectId, projectInfo.id))
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        // Cascade-display: 404 a soft-deleted ticket OR a ticket whose
        // project_info parent has been soft-deleted (Task #34).
        .where(and(
          eq(engineeringTickets.id, id),
          isNull(engineeringTickets.deletedAt),
          sql`(${engineeringTickets.projectId} IS NULL OR ${projectInfo.deletedAt} IS NULL)`,
        ));

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
        .where(and(eq(workItems.engineeringTicketId, id), sql`${workItems.deletedAt} IS NULL`))
        .orderBy(asc(workItems.sortOrder));

      const taskIds = tasks.map((t: any) => t.id);
      let recentActivity: any[] = [];
      if (taskIds.length > 0) {
        recentActivity = await db.select().from(taskActivityLog)
          .where(inArray(taskActivityLog.workItemId, taskIds))
          .orderBy(desc(taskActivityLog.createdAt))
          .limit(20);
      }

      const developerUser = ticket.ticket.projectDeveloperUserId
        ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, ticket.ticket.projectDeveloperUserId)).limit(1)
        : [];
      const designerUser = ticket.ticket.designerUserId
        ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, ticket.ticket.designerUserId)).limit(1)
        : [];

      // Enrich with opportunity data if the ticket is linked to one.
      let opportunityInfo: { id: number; source: string | null; stage: string | null; notes: string | null; estimatedValue: string | null } | null = null;
      if (ticket.ticket.opportunityId) {
        const [opp] = await db
          .select({
            id: opportunities.id,
            source: opportunities.source,
            stage: opportunities.stage,
            notes: opportunities.notes,
            estimatedValue: opportunities.estimatedValue,
          })
          .from(opportunities)
          .where(eq(opportunities.id, ticket.ticket.opportunityId));
        if (opp) opportunityInfo = opp as typeof opportunityInfo;
      }

      res.json({
        ...ticket,
        clientName: ticket.clientName || ticket.ticket.clientNameSnapshot || null,
        projectName: ticket.projectName || ticket.ticket.projectSiteName || null,
        tasks,
        recentActivity,
        developerName: developerUser[0]?.name || null,
        designerName: designerUser[0]?.name || null,
        // Opportunity enrichment for CRM boundary cues on the detail page.
        opportunityInfo,
      });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/pd/tickets", requireAuth, requirePermission('pd_tickets', 'create'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      // NOTE: the former `canCreatePdTicket` double-gate is removed.
      // `PD_CREATE_ROLES` in shared/roles/pd-roles.ts is a stricter list
      // than the authoritative `pd_tickets.create_roles` default
      // ([COO_ADMIN, CEO_ADMIN, CCO, PROJECT_DEVELOPER]), which meant a
      // CCO could pass the central permission check and then be
      // blocked by the local hardcoded check with a confusing 403.
      // The authoritative permission table is now the only source of
      // truth for this decision.

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

      // Duplicate-guard: refuse to create a second open ticket for the same
      // (projectId, requestType) pair unless the caller explicitly opts in
      // with `allowDuplicate: true`. Closed tickets (Completed / Cancelled)
      // are ignored — it's legitimate to raise a new Cost Proposal after a
      // previous one is closed. This is the root-cause fix for the
      // duplicate PD tickets surfacing in the list view.
      if (!body.allowDuplicate) {
        const existingOpen = await db
          .select({ id: engineeringTickets.id, status: engineeringTickets.status, createdAt: engineeringTickets.createdAt })
          .from(engineeringTickets)
          .where(and(
            eq(engineeringTickets.projectId, Number(body.projectId)),
            eq(engineeringTickets.requestType, body.requestType),
            // Match both legacy (Draft / In Progress / On Hold / Completed /
            // Cancelled) and canonical engineering-board values via LOWER().
            // Anything in the terminal-synonym list is considered closed and
            // therefore re-openable with a new ticket.
            // Duplicate guard: a ticket only stops counting toward "active
            // for this opportunity" once it reaches a true terminal state.
            // Per shared/engineering-ticket-status.ts, only `complete` (and
            // its legacy synonyms / Cancelled) is terminal — `qc_approved`
            // is still in-flight (post-QC, pre-closeout) so it must remain
            // counted, otherwise users can spawn a duplicate ticket while
            // engineering is still finishing the existing one.
            sql`LOWER(COALESCE(${engineeringTickets.status}, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')`,
            // Cascade-display: ignore soft-deleted tickets in dup guard (Task #34).
            isNull(engineeringTickets.deletedAt),
          ))
          .limit(1);
        if (existingOpen.length > 0) {
          return res.status(409).json({
            error: "duplicate_ticket",
            message: `An open ${body.requestType} ticket already exists for this project (ticket #${existingOpen[0].id}). Set allowDuplicate: true to create another anyway.`,
            existingTicketId: existingOpen[0].id,
          });
        }
      }

      const [ticket] = await db.insert(engineeringTickets).values({
        clientId: body.clientId || null,
        clientNameSnapshot: body.clientNameSnapshot || null,
        projectId: body.projectId || null,
        // Optional link to the commercial opportunity that triggered this
        // PD work. Added by migration 20260415_pd_workflow_separation.sql.
        opportunityId: body.opportunityId ? Number(body.opportunityId) : null,
        projectSiteName: body.projectSiteName.trim(),
        dueDate: body.dueDate || null,
        requestType: body.requestType,
        priority: body.priority || "Medium",
        status: body.status ? normalizeEngineeringTicketStatus(body.status) : ENGINEERING_TICKET_DEFAULT_STATUS,
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

      logAuditFromReq(req, {
        entityType: "pd_ticket",
        entityId: String(ticket.id),
        action: "create",
        changesJson: {
          requestType: ticket.requestType,
          projectId: ticket.projectId,
          opportunityId: ticket.opportunityId ?? null,
          clientId: ticket.clientId ?? null,
          projectSiteName: ticket.projectSiteName,
          priority: ticket.priority,
          status: ticket.status,
        },
      });

      res.status(201).json(ticket);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/pd/tickets/:id", requireAuth, requirePermission('pd_tickets', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      const id = parseInt(paramStr(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ticket ID" });

      // Cascade-display: PATCH on a soft-deleted ticket should 404 (Task #34).
      const [existing] = await db.select().from(engineeringTickets).where(and(eq(engineeringTickets.id, id), isNull(engineeringTickets.deletedAt)));
      if (!existing) return res.status(404).json({ error: "Ticket not found" });

      if (!canViewAllTickets(role) && existing.createdBy !== user?.id && existing.projectDeveloperUserId !== user?.id) {
        return res.status(403).json({ error: "Not authorized to edit this ticket" });
      }

      const updates: Record<string, any> = { updatedAt: new Date() };
      const allowedFields = [
        "clientId", "clientNameSnapshot", "projectId", "opportunityId", "projectSiteName",
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

      const [updated] = await db.update(engineeringTickets).set(updates).where(eq(engineeringTickets.id, id)).returning();

      // Log only the fields that actually changed so the audit trail is
      // useful for debugging stale data complaints.
      const changedFields = Object.keys(updates).filter(k => k !== "updatedAt");
      if (changedFields.length > 0) {
        logAuditFromReq(req, {
          entityType: "pd_ticket",
          entityId: String(id),
          action: "update",
          changesJson: changedFields.reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (updates as Record<string, unknown>)[k];
            return acc;
          }, {}),
        });
      }

      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/pd/tickets/:id", requireAuth, requirePermission('pd_tickets', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";
      const id = parseInt(paramStr(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ticket ID" });

      // Cascade-display: a re-DELETE on an already soft-deleted ticket
      // should be idempotent, not 200-with-spurious-cascade. Filter to
      // active rows only (Task #34).
      const [existing] = await db.select().from(engineeringTickets).where(and(eq(engineeringTickets.id, id), isNull(engineeringTickets.deletedAt)));
      if (!existing) return res.status(404).json({ error: "Ticket not found" });

      if (!canViewAllTickets(role) && existing.createdBy !== user?.id && existing.projectDeveloperUserId !== user?.id) {
        return res.status(403).json({ error: "Not authorized to delete this ticket" });
      }

      // Soft-delete only (Task #34). The previous implementation hard-deleted
      // the pd_ticket and CASCADE-deleted every work_item linked to it
      // (along with expense_task_links, intake_tasks, project_eng_tasks,
      // documents, qc_item_instances, deliverables, task_activity_log).
      // That destroyed historical project-development data the moment a
      // PD ticket was removed in error and required a checkpoint rollback
      // to recover. We now mark the ticket and all its linked work_items
      // as soft-deleted; the new FK on work_items.pd_ticket_id stays
      // intact (ON DELETE SET NULL is only used when the ticket is
      // physically removed by an out-of-band admin sweep). All cascade
      // peripheral cleanups are skipped — those rows are now hidden via
      // the existing isNull(workItems.deletedAt) read filters.
      const linkedTasks = await db.select({ id: workItems.id }).from(workItems)
        .where(and(eq(workItems.engineeringTicketId, id), isNull(workItems.deletedAt)));
      const deletedTaskIds = linkedTasks.map((t: any) => t.id);

      const now = new Date();
      await db.transaction(async (tx: typeof db) => {
        if (deletedTaskIds.length > 0) {
          await tx
            .update(workItems)
            .set({ deletedAt: now, updatedAt: now })
            .where(inArray(workItems.id, deletedTaskIds));
        }
        await tx
          .update(engineeringTickets)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(engineeringTickets.id, id));
      });

      logAuditFromReq(req, {
        entityType: "pd_ticket",
        entityId: String(id),
        action: "delete",
        changesJson: {
          projectSiteName: existing.projectSiteName,
          softDeleted: true,
          cascadeWorkItemIds: deletedTaskIds,
          cascadeWorkItemCount: deletedTaskIds.length,
        },
      });

      res.json({ success: true, softDeleted: true, deletedTaskCount: deletedTaskIds.length });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/pd/tickets/:id/task-templates", requireAuth, requirePermission('pd_tickets', 'view'), async (req: Request, res: Response) => {
    try {
      const id = parseInt(paramStr(req.params.id));
      // Cascade-display: hide soft-deleted tickets from template lookup (Task #34).
      const [ticket] = await db.select().from(engineeringTickets).where(and(eq(engineeringTickets.id, id), isNull(engineeringTickets.deletedAt)));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      const templates = PD_REQUEST_TYPE_TASK_TEMPLATES[ticket.requestType] || [];
      res.json({ requestType: ticket.requestType, templates });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/pd/tickets/:id/spawn-tasks", requireAuth, requirePermission('pd_tickets', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      // NOTE: `canCreatePdTicket` double-gate removed — see POST /api/pd/tickets.
      const id = parseInt(paramStr(req.params.id));
      // Cascade-display: refuse spawn-tasks on a soft-deleted ticket (Task #34).
      const [ticket] = await db.select().from(engineeringTickets).where(and(eq(engineeringTickets.id, id), isNull(engineeringTickets.deletedAt)));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      if (ticket.tasksSpawnedAt) {
        return res.status(409).json({ error: "Tasks already spawned for this ticket" });
      }

      const { selectedTasks, customTasks } = req.body || {};
      const spawned = await spawnTasksForTicket(ticket, user, selectedTasks, customTasks);
      res.json({ spawned: spawned.length, tasks: spawned });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/pd/tickets/:id/engineering-tasks", requireAuth, requirePermission('pd_tickets', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      // NOTE: `canCreatePdTicket` double-gate removed — see POST /api/pd/tickets.
      const id = parseInt(paramStr(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ticket ID" });

      // Cascade-display: refuse engineering-task creation on soft-deleted ticket (Task #34).
      const [ticket] = await db.select().from(engineeringTickets).where(and(eq(engineeringTickets.id, id), isNull(engineeringTickets.deletedAt)));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      if (!ticket.projectId) return res.status(400).json({ error: "Ticket is not linked to a project" });

      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ error: "Task title is required" });

      const priority = String(req.body?.priority || "Medium");
      const normalizedPriority = ["High", "Medium", "Low"].includes(priority) ? priority : "Medium";

      const [task] = await db.insert(workItems).values({
        projectId: ticket.projectId,
        workstream: "ENG",
        source: "UI",
        type: "task",
        taskTypeTag: "PD",
        title: title.startsWith("[PD]") ? title : `[PD] ${title}`,
        description: req.body?.description?.trim()
          ? req.body.description.trim()
          : `Created from PD Ticket #${ticket.id} (${ticket.requestType}) for ${ticket.projectSiteName}`,
        status: "TO DO",
        priority: normalizedPriority,
        endDate: req.body?.dueDate || ticket.dueDate || null,
        engineeringTicketId: ticket.id,
        ownerUserId: req.body?.ownerUserId || null,
        createdBy: user?.id || null,
      }).returning();

      if (task?.ownerUserId) {
        await db.insert(workItemAssignments).values({
          workItemId: task.id,
          userId: task.ownerUserId,
          role: "OWNER",
        }).onConflictDoNothing();
      }

      if (task) {
        await db.insert(taskActivityLog).values({
          workItemId: task.id,
          actorId: user?.id || null,
          actionType: "created",
          newValue: `Task created from PD Ticket #${ticket.id}`,
        });
      }

      if (!ticket.tasksSpawnedAt) {
        await db.update(engineeringTickets)
          .set({
            tasksSpawnedAt: new Date(),
            // Bump from "haven't started" states to in_progress on first
            // spawn; otherwise preserve whatever board state the ticket is in.
            status: ["to_do", "not_started"].includes(normalizeEngineeringTicketStatus(ticket.status))
              ? "in_progress"
              : normalizeEngineeringTicketStatus(ticket.status),
          })
          .where(eq(engineeringTickets.id, ticket.id));
      }

      res.status(201).json(task);
    } catch (err: any) {
      throw err;
    }
  });

  // Renamed 2026-04-20: was `/api/pd/dashboard`. The new opportunities-aggregation
  // dashboard owns that path now (see server/departments/opportunities-routes.ts).
  // This legacy ticket-counts endpoint is preserved at the more specific path for
  // any internal callers still relying on pd_tickets aggregates.
  app.get("/api/pd/tickets/dashboard", requireAuth, requirePermission('pd_dashboard', 'view'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";

      // Cascade-display: ignore soft-deleted PD tickets in dashboard counts (Task #34).
      const allTicketsRaw = await db.select().from(engineeringTickets).where(isNull(engineeringTickets.deletedAt));
      const allTickets = await filterTicketsByRole(allTicketsRaw, user, role);
      const today = todaySast();

      // All status comparisons go through the canonical normaliser so the
      // tile counts work for both legacy text values and the new
      // engineering-board states (task #71 follow-up).
      const total = allTickets.length;
      const isDone = (t: any) => isTicketDoneForReporting(t.status);
      const active = allTickets.filter(t => !isDone(t)).length;
      const overdue = allTickets.filter(t => t.dueDate && t.dueDate < today && !isDone(t)).length;
      const dueThisWeek = allTickets.filter(t => {
        if (!t.dueDate || isDone(t)) return false;
        const d = new Date(t.dueDate);
        const now = new Date();
        const weekEnd = new Date();
        weekEnd.setDate(now.getDate() + 7);
        return d >= now && d <= weekEnd;
      }).length;
      const onHold = allTickets.filter(t => isTicketBlocked(t.status)).length;
      const completed = allTickets.filter(isDone).length;
      const inApproval = allTickets.filter(t => {
        const c = normalizeEngineeringTicketStatus(t.status);
        return c === "needs_approval" || c === "qc_approved" || c === "provide_feedback" || c === "operational_approval";
      }).length;

      res.json({ total, active, overdue, dueThisWeek, onHold, completed, inApproval });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/pd/pipeline", requireAuth, requirePermission('pd_dashboard', 'view'), async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const role = user?.companyRole || user?.role || "";

      const allTicketsRaw = await db
        .select({
          ticket: engineeringTickets,
          clientName: clients.name,
          projectName: projectInfo.projectName,
          developerName: sql<string>`(SELECT name FROM users WHERE id = ${engineeringTickets.projectDeveloperUserId})`,
        })
        .from(engineeringTickets)
        .leftJoin(clients, eq(engineeringTickets.clientId, clients.id))
        .leftJoin(projectInfo, eq(engineeringTickets.projectId, projectInfo.id))
        // Cascade-display: hide soft-deleted PD tickets and tickets whose
        // project was soft-deleted from the pipeline (Task #34).
        .where(and(
          isNull(engineeringTickets.deletedAt),
          or(isNull(engineeringTickets.projectId), isNull(projectInfo.deletedAt)),
        ))
        .orderBy(desc(engineeringTickets.createdAt));

      const allTickets = await filterTicketsByRole(allTicketsRaw, user, role);

      const handoverRows = await db
        .select({
          projectId: projectPdPmHandover.projectId,
          status: projectPdPmHandover.status,
          handoverReadinessStatus: projectPdPmHandover.handoverReadinessStatus,
        })
        .from(projectPdPmHandover);
      const handoverMap: Map<any, any> = new Map(handoverRows.map((h: any) => [h.projectId, h]));

      const taskCountRows = await db
        .select({
          pdTicketId: workItems.engineeringTicketId,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${workItems.status} IN ('Completed', 'DONE', 'Done'))::int`,
        })
        .from(workItems)
        .where(sql`${workItems.engineeringTicketId} IS NOT NULL AND ${workItems.deletedAt} IS NULL`)
        .groupBy(workItems.engineeringTicketId);
      const taskCountMap: Map<any, any> = new Map(taskCountRows.map((r: any) => [r.pdTicketId!, { total: r.total, completed: r.completed }]));

      const today = todaySast();
      const oneWeekAgo = sastDateNDaysAgo(7);
      const twoWeeksAgo = sastDateNDaysAgo(14);
      const oneMonthAgo = sastDateNDaysAgo(30);

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
        // Map to Kanban column. The board now uses canonical status values
        // (to_do, in_progress, hold, needs_approval, qc_approved,
        // provide_feedback, operational_approval, complete, …); legacy
        // free-form values are tolerated via the normaliser.
        const canonical = normalizeEngineeringTicketStatus(t.status);
        let kanbanColumn = "New";
        if (canonical === "to_do" || canonical === "not_started") kanbanColumn = "New";
        else if (canonical === "in_progress" || canonical === "projects_assistance") kanbanColumn = "In Progress";
        else if (canonical === "hold") kanbanColumn = "In Progress";
        else if (canonical === "needs_approval" || canonical === "qc_approved" || canonical === "provide_feedback" || canonical === "operational_approval") kanbanColumn = "Under Review";
        else if (canonical === "complete") kanbanColumn = "Handed Over";
        if (handover?.status === "SUBMITTED_FOR_PM_REVIEW") kanbanColumn = "Under Review";
        if (handover?.handoverReadinessStatus === "READY_FOR_HANDOVER" && handover?.status === "DRAFT") kanbanColumn = "Ready for Handover";
        if (handover?.status === "ACCEPTED") kanbanColumn = "Handed Over";

        const daysInStage = Math.max(0, Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / 86400000));
        const isOverdue = t.dueDate && t.dueDate < today && !isTicketDoneForReporting(t.status);

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
        byRequestType[t.requestType] = (byRequestType[t.requestType] || 0) + (isTicketDoneForReporting(t.status) ? 0 : 1);

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
        notStarted: handoverRows.filter((h: any) => !h.status || h.status === "DRAFT").length,
        draft: handoverRows.filter((h: any) => h.status === "DRAFT").length,
        submitted: handoverRows.filter((h: any) => h.status === "SUBMITTED_FOR_PM_REVIEW").length,
        accepted: handoverRows.filter((h: any) => h.status === "ACCEPTED").length,
        rejected: handoverRows.filter((h: any) => h.status === "REJECTED").length,
      };

      // Pipeline value from financial estimates
      const activeTicketsRaw = allTickets.map(r => r.ticket);
      const totalPipelineValue = activeTicketsRaw
        .filter(t => !isTicketDoneForReporting(t.status) && t.estimatedProjectValue)
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
      throw err;
    }
  });

  app.get("/api/pd/users", requireAuth, async (_req: Request, res: Response) => {
    try {
      // NOTE: the `users` table exposes its company role on the `role`
      // column (text). A prior version of this read used
      // `(users as any).companyRole`, which is NOT a column on the table
      // — the alias resolved to `undefined` and every user came back
      // with `role: null`. The PD ticket designer/developer pickers
      // filter by role, so that bug silently emptied those dropdowns.
      const allUsers = await db.select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .orderBy(asc(users.name));
      res.json(allUsers);
    } catch (err: any) {
      throw err;
    }
  });

  /**
   * PD Reports endpoint.
   *
   * Returns three distinct sections — each sourced from its own table
   * and never mixed:
   *
   * 1. `commercialFunnel` — Opportunity-based metrics from the
   *    `opportunities` table. Measures the commercial pipeline:
   *    how many deals are in what stage, how much value is active,
   *    and what the Pipedrive vs internal split looks like.
   *
   * 2. `throughput` + `pipelineHealth` — PD-work-queue metrics from
   *    the `engineeringTickets` table. Measures engineering request throughput:
   *    how many tickets were created vs completed, what the backlog
   *    looks like by status/type/member, and what the overdue count
   *    is. Pipeline-health metrics are now FY-scoped (fix: previously
   *    used `allTickets` instead of `fyTickets`, leaking stale
   *    system-wide state into FY reports).
   *
   * 3. `handover` — Handover-readiness metrics from the
   *    `projectPdPmHandover` table. Measures the PD→PM gate:
   *    submitted vs accepted vs rejected, cycle time, rejection rate.
   *
   * KPI definitions are documented inline with each computation.
   */
  app.get("/api/pd/reports", requireAuth, requirePermission('pd_dashboard', 'view'), async (req: Request, res: Response) => {
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

      const today = todaySast();
      const currentMonth = today.slice(0, 7); // YYYY-MM (SAST)

      // ===== DATA FETCH =====
      // Cascade-display: ignore soft-deleted PD tickets in reports (Task #34).
      const allTickets = await db.select().from(engineeringTickets).where(isNull(engineeringTickets.deletedAt));
      const fyTickets = allTickets.filter((t: any) => t.createdAt >= fyStart && t.createdAt <= fyEnd);

      const allHandovers = await db.select().from(projectPdPmHandover);
      const fyHandovers = allHandovers.filter((h: any) => h.createdAt >= fyStart && h.createdAt <= fyEnd);

      const handoverHistory = await db.select().from(projectHandoverHistory)
        .where(sql`${projectHandoverHistory.gateId} = 'PD_PM_HANDOVER'`);

      const pdUsers = await db.select({ id: users.id, name: users.name }).from(users);
      const userMap = new Map(pdUsers.map((u: any) => [u.id, u.name]));

      // Fetch opportunities for the commercial funnel section.
      const allOpps = await db.select().from(opportunities).where(isNull(opportunities.deletedAt));

      // ===== SECTION 1: COMMERCIAL FUNNEL =====
      // Source: `opportunities` table (NOT mixed with pd_tickets).
      const activeOpps = allOpps.filter((o: any) => o.status !== "won" && o.status !== "lost");
      const wonFy = allOpps.filter((o: any) => o.status === "won" && o.signedDate && o.signedDate >= fyStart.toISOString().slice(0, 10) && o.signedDate <= fyEnd.toISOString().slice(0, 10));
      const lostFy = allOpps.filter((o: any) => o.status === "lost" && o.updatedAt && o.updatedAt >= fyStart && o.updatedAt <= fyEnd);

      /** KPI: Active pipeline value (R). Sum of estimatedValue for
       *  opportunities with status not won or lost. Source: opportunities.estimated_value. */
      const activePipelineValue = activeOpps.reduce(
        (sum: number, o: any) => sum + (o.estimatedValue ? parseFloat(o.estimatedValue) : 0),
        0,
      );

      /** KPI: Opportunity stage breakdown. Count of active (not won/lost)
       *  opportunities grouped by stage. Source: opportunities.stage. */
      const byStage: Record<string, number> = {};
      for (const o of activeOpps) {
        const stage = o.stage || "unknown";
        byStage[stage] = (byStage[stage] || 0) + 1;
      }

      const commercialFunnel = {
        /** KPI: Total non-deleted opportunities in the system. */
        total: allOpps.length,
        /** KPI: Active pipeline — opportunities that are neither won nor lost. */
        active: activeOpps.length,
        /** KPI: Won in FY — opportunities with status=won and signedDate within FY window. */
        wonFy: wonFy.length,
        /** KPI: Lost in FY — opportunities with status=lost and updatedAt within FY window. */
        lostFy: lostFy.length,
        /** KPI: Active pipeline value (R). */
        activePipelineValue,
        /** KPI: Active pipeline value (kWp). */
        activePipelineKwp: activeOpps.reduce(
          (sum: number, o: any) => sum + (o.estimatedKwp ? parseFloat(o.estimatedKwp) : 0),
          0,
        ),
        byStage,
        /** KPI: Pipedrive vs internal split. */
        pipedriveCount: allOpps.filter((o: any) => o.source === "pipedrive").length,
        internalCount: allOpps.filter((o: any) => o.source !== "pipedrive").length,
      };

      // ===== SECTION 2: PD WORK QUEUE — THROUGHPUT =====
      // Source: `engineeringTickets` table (NOT mixed with opportunities).

      /** KPI: Tickets created this month. Count of pd_tickets with
       *  createdAt in the current calendar month (SAST). */
      const toSastYm = (d: Date) => new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 7);
      const thisMonthTickets = fyTickets.filter((t: any) => toSastYm(t.createdAt) === currentMonth);

      /** KPI: Tickets completed in FY. Count of pd_tickets with
       *  status="Completed" and createdAt within the FY window. */
      const completedFy = fyTickets.filter((t: any) => isTicketDoneForReporting(t.status));

      /** KPI: Tickets completed this month. Subset of completedFy where
       *  updatedAt is in the current calendar month. */
      const completedThisMonth = completedFy.filter((t: any) => toSastYm(t.updatedAt) === currentMonth);

      /** KPI: Average cycle time by request type (days). For completed
       *  FY tickets, the number of days between createdAt and updatedAt,
       *  averaged per request type. */
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

      /** KPI: Average handover cycle time (days). For accepted handovers,
       *  the number of days between handover createdAt and acceptedAt.
       *  All-time, not FY-scoped, because handovers span FY boundaries. */
      const acceptedHandovers = allHandovers.filter((h: any) => h.status === "ACCEPTED" && h.acceptedAt && h.createdAt);
      const avgHandoverCycleTime = acceptedHandovers.length > 0
        ? Math.round(acceptedHandovers.reduce((sum: any, h: any) => sum + Math.max(0, Math.floor((h.acceptedAt!.getTime() - h.createdAt.getTime()) / 86400000)), 0) / acceptedHandovers.length)
        : null;

      /** KPI: Quarterly breakdown. Created/completed/submitted counts per
       *  FY quarter (Sep-Nov, Dec-Feb, Mar-May, Jun-Aug). */
      const quarterlyData = quarters.map((q: any) => {
        const created = fyTickets.filter((t: any) => t.createdAt >= q.start && t.createdAt <= q.end).length;
        const completed = completedFy.filter((t: any) => t.updatedAt >= q.start && t.updatedAt <= q.end).length;
        const submitted = fyHandovers.filter((h: any) => h.submittedAt && h.submittedAt >= q.start && h.submittedAt <= q.end).length;
        return { quarter: q.label, created, completed, submitted };
      });

      // ===== SECTION 2b: PD WORK QUEUE — ACTIVE STATE =====
      // FIX: These now use `fyTickets` — previously used `allTickets`,
      // which leaked system-wide state into FY-specific reports.
      // The overdue count and workload distribution intentionally remain
      // all-time because an overdue ticket is overdue regardless of when
      // it was created.

      /** KPI: Active tickets by status (FY-scoped). Count of non-completed,
       *  non-cancelled FY tickets grouped by status. */
      const activeByStatus: Record<string, number> = {};
      /** KPI: Active tickets by request type (FY-scoped). */
      const activeByType: Record<string, number> = {};
      const fyActive = fyTickets.filter((t: any) => !isTicketDoneForReporting(t.status));
      for (const t of fyActive) {
        // Bucket under canonical key so the report shows engineering-board
        // labels (in_progress, hold, needs_approval, …) instead of the old
        // Title-Case text values.
        const canonical = normalizeEngineeringTicketStatus(t.status);
        activeByStatus[canonical] = (activeByStatus[canonical] || 0) + 1;
        activeByType[t.requestType] = (activeByType[t.requestType] || 0) + 1;
      }

      /** KPI: Overdue tickets (all-time). Count of tickets with dueDate
       *  before today and status not Completed/Cancelled. Not FY-scoped. */
      const overdueCount = allTickets.filter((t: any) => t.dueDate && t.dueDate < today && !isTicketDoneForReporting(t.status)).length;

      /** KPI: Tickets per PD team member (all-time active). Count of
       *  non-completed, non-cancelled tickets grouped by developer. */
      const ticketsPerMember: Record<string, number> = {};
      for (const t of allTickets.filter((t: any) => !isTicketDoneForReporting(t.status))) {
        const name = (t as any).projectDeveloperUserId ? (userMap.get((t as any).projectDeveloperUserId) || "Unassigned") : "Unassigned";
        ticketsPerMember[name as string] = (ticketsPerMember[name as string] || 0) + 1;
      }

      // ===== SECTION 3: HANDOVER READINESS =====
      // Source: `projectPdPmHandover` table (NOT mixed with tickets).

      /** KPI: Handovers submitted (all-time). Count of handovers with
       *  a non-null submittedAt. */
      const submittedHandovers = allHandovers.filter((h: any) => h.submittedAt);
      /** KPI: Handovers accepted / rejected (all-time). */
      const accepted = allHandovers.filter((h: any) => h.status === "ACCEPTED").length;
      const rejected = allHandovers.filter((h: any) => h.status === "REJECTED").length;
      /** KPI: Rejection rate (%). rejected / (accepted + rejected) × 100. */
      const rejectionRate = (accepted + rejected) > 0 ? Math.round((rejected / (accepted + rejected)) * 100) : 0;

      /** KPI: Average decision time (days). Days from submittedAt to
       *  acceptedAt or rejectedAt, whichever came first. All-time. */
      const decidedHandovers = allHandovers.filter((h: any) => h.submittedAt && (h.acceptedAt || h.rejectedAt));
      const avgDecisionTime = decidedHandovers.length > 0
        ? Math.round(decidedHandovers.reduce((sum: any, h: any) => {
            const decisionDate = h.acceptedAt || h.rejectedAt!;
            return sum + Math.max(0, Math.floor((decisionDate.getTime() - h.submittedAt!.getTime()) / 86400000));
          }, 0) / decidedHandovers.length)
        : null;

      // Top rejection reasons
      const rejectionReasons: Record<string, number> = {};
      const rejectedHistory = handoverHistory.filter((h: any) => h.action === "PD_PM_HANDOVER_REJECTED");
      for (const h of rejectedHistory) {
        const details = h.details as any;
        const reason = details?.reason || "No reason specified";
        const shortReason = reason.length > 80 ? reason.slice(0, 80) + "..." : reason;
        rejectionReasons[shortReason] = (rejectionReasons[shortReason] || 0) + 1;
      }

      // --- Cross-functional demand ---
      // Use the shared engineering request-type set (already built at the
      // top of this file from `ENGINEERING_REQUEST_TYPES`) instead of
      // hand-inlining the list here — the hand-inlined copy had already
      // drifted from the source constant.
      const engineeringTicketCount = allTickets.filter(
        (t: any) => engineeringRequestTypesSet.has(t.requestType) && !isTicketDoneForReporting(t.status),
      ).length;

      // W2: Surface Pipedrive sync freshness in the commercial funnel report
      // so users see a warning when CRM data is stale.
      let _integrationFreshness: { pipedrive: { isStale: boolean; warning: string | null } } | undefined;
      try {
        const { isIntegrationFresh } = await import("./services/integration-freshness-service");
        const pdFresh = await isIntegrationFresh("pipedrive");
        _integrationFreshness = {
          pipedrive: {
            isStale: !pdFresh,
            warning: !pdFresh
              ? "Pipedrive data may be stale — commercial funnel metrics could be outdated. Trigger a sync from Admin → Pipedrive."
              : null,
          },
        };
      } catch { /* non-blocking */ }

      res.json({
        fy,
        fyLabel: `FY${fy} (Sep ${fy - 1} – Aug ${fy})`,
        _integrationFreshness,
        commercialFunnel,
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
          engineeringRequests: engineeringTicketCount,
        },
      });
    } catch (err: any) {
      throw err;
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
      throw err;
    }
  });
}

// Client-id generation lives in server/lib/client-id-generator.ts so both
// /api/pd/clients and /api/clients share a single race-safe implementation.

export async function spawnTasksForTicket(ticket: any, user: any, selectedTasks?: string[], customTasks?: { title: string; priority: string }[]): Promise<any[]> {
  // Atomic idempotency claim: only the first caller for a given ticket
  // wins the marker. Subsequent retries / concurrent submits get an empty
  // result instead of duplicating tasks. Architect-flagged 2026-04-20.
  if (!ticket.projectId) return [];

  let templates = PD_REQUEST_TYPE_TASK_TEMPLATES[ticket.requestType] || [];
  if (selectedTasks && Array.isArray(selectedTasks)) {
    const selectedSet = new Set(selectedTasks);
    templates = templates.filter(t => selectedSet.has(t.title));
  }
  const allTasks: { title: string; priority: string }[] = [
    ...templates,
    ...(Array.isArray(customTasks) ? customTasks.filter(t => t.title?.trim()) : []),
  ];

  // Atomic claim + insert in a single transaction. If task inserts fail
  // for any reason, the claim rolls back too so retries remain possible.
  // Architect-flagged 2026-04-20.
  return db.transaction(async (tx: typeof db) => {
    const claimed = await tx
      .update(engineeringTickets)
      .set({
        tasksSpawnedAt: new Date(),
        // Bump "haven't started" states to in_progress on first spawn;
        // otherwise preserve the board state the ticket is currently in.
        status: ["to_do", "not_started"].includes(normalizeEngineeringTicketStatus(ticket.status))
          ? "in_progress"
          : normalizeEngineeringTicketStatus(ticket.status),
      })
      .where(and(eq(engineeringTickets.id, ticket.id), isNull(engineeringTickets.tasksSpawnedAt)))
      .returning({ id: engineeringTickets.id });
    if (claimed.length === 0) return [];

    const spawned: any[] = [];
    for (let i = 0; i < allTasks.length; i++) {
      const tmpl = allTasks[i];
      const [task] = await tx.insert(workItems).values({
        projectId: ticket.projectId,
        workstream: "ENG",
        source: "UI",
        title: `[PD] ${tmpl.title}`,
        description: `Auto-spawned from PD Ticket #${ticket.id} (${ticket.requestType}) for ${ticket.projectSiteName}`,
        status: "TO DO",
        priority: tmpl.priority === "High" ? "High" : "Medium",
        endDate: ticket.dueDate || null,
        sortOrder: i,
        engineeringTicketId: ticket.id,
        createdBy: user?.id || null,
      }).returning();
      if (task) {
        await tx.insert(taskActivityLog).values({
          workItemId: task.id,
          actorId: user?.id || null,
          actionType: "created",
          newValue: `Task spawned from PD Ticket #${ticket.id} (${ticket.requestType})`,
        });
        spawned.push(task);
      }
    }
    return spawned;
  });
}
