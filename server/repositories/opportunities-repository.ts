import { eq, desc, isNull, and, inArray, sql, ilike, asc } from "drizzle-orm";
import {
  opportunities,
  clients,
  projectInfo,
  sites,
  pdTickets,
  projectPhaseHistory,
  phaseTemplate,
  phaseTemplateItem,
  type Opportunity,
  type PdTicket,
} from "@shared/schema/projects";
import { workItems } from "@shared/schema/tasks";
import { users } from "@shared/schema/users";
import { db } from "../db";
import { ENGINEERING_REQUEST_TYPES } from "@shared/roles/pd-roles";

// ---- Inferred row shapes for select projections ----

interface WorkingListRow {
  id: number;
  pipedriveDealId: string | null;
  source: string | null;
  stage: string | null;
  status: string | null;
  signedDate: string | Date | null;
  expectedCloseDate: string | Date | null;
  notes: string | null;
  dealName: string | null;
  updatedAt: Date | null;
  clientId: number | null;
  clientName: string | null;
  dealOwnerUserId: number | null;
  dealOwnerUserName: string | null;
  dealOwnerNameSnapshot: string | null;
  siteId: number | null;
  siteName: string | null;
  siteAddress: string | null;
}

interface CountByOpportunity {
  opportunityId: number | null;
  count: number;
}

interface MappingContextOpportunity {
  id: number;
  pipedriveDealId: string | null;
  source: string | null;
  notes: string | null;
  stage: string | null;
  status: string | null;
  signedDate: string | Date | null;
  clientId: number | null;
  clientName: string | null;
}

interface LinkedProject {
  id: number;
  projectName: string;
  clientId: number | null;
}

interface LikelyClient {
  id: number;
  name: string;
  clientId: string | null;
}

interface LikelyProject {
  id: number;
  projectName: string;
  clientId: number | null;
}

interface ActivePhaseTemplate {
  id: number;
  phase: string;
  name: string;
  version: number;
}

interface TemplateItemRow {
  id: number;
  title: string;
  description: string | null;
  defaultPriority: string | null;
  offsetDaysFromPhaseStart: number | null;
  isDeleted: boolean;
}

interface ClientRow {
  id: number;
  name: string;
  clientId: string | null;
}

export interface IntakeOpportunityRow {
  id: number;
  pipedriveDealId: string | null;
  source: string | null;
  stage: string | null;
  status: string | null;
  estimatedValue: string | null;
  expectedCloseDate: string | Date | null;
  signedDate: string | Date | null;
  notes: string | null;
  updatedAt: Date | null;
  createdAt: Date | null;
  clientId: number | null;
  clientName: string | null;
}

export interface IntakeTicketRow {
  id: number;
  opportunityId: number | null;
  clientId: number | null;
  projectId: number | null;
  projectSiteName: string;
  requestType: string;
  priority: string;
  status: string;
  dueDate: string | Date | null;
  tasksSpawnedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  projectDeveloperUserId: number | null;
  clientName: string | null;
  projectName: string | null;
  developerName: string | null;
  subTasksTotal: number;
  subTasksDone: number;
  nextAction: string | null;
}

export class OpportunitiesRepository {
  // ---- Working-list queries ----

  async getWorkingListRows(): Promise<WorkingListRow[]> {
    return db
      .select({
        id: opportunities.id,
        pipedriveDealId: opportunities.pipedriveDealId,
        source: opportunities.source,
        stage: opportunities.stage,
        status: opportunities.status,
        signedDate: opportunities.signedDate,
        expectedCloseDate: opportunities.expectedCloseDate,
        notes: opportunities.notes,
        dealName: opportunities.dealName,
        updatedAt: opportunities.updatedAt,
        clientId: opportunities.clientId,
        clientName: clients.name,
        dealOwnerUserId: opportunities.dealOwnerUserId,
        dealOwnerUserName: users.name,
        dealOwnerNameSnapshot: opportunities.dealOwnerName,
        siteId: opportunities.siteId,
        siteName: sites.siteName,
        siteAddress: sites.address,
      })
      .from(opportunities)
      .leftJoin(clients, eq(clients.id, opportunities.clientId))
      .leftJoin(users, eq(users.id, opportunities.dealOwnerUserId))
      .leftJoin(sites, eq(sites.id, opportunities.siteId))
      .where(and(
        isNull(opportunities.deletedAt),
        eq(opportunities.source, "pipedrive"),
      ))
      .orderBy(desc(opportunities.updatedAt));
  }

  async getLinkedProjectCounts(opportunityIds: number[]): Promise<CountByOpportunity[]> {
    const rows = await db
      .select({
        opportunityId: projectInfo.opportunityId,
        count: sql<number>`count(*)`,
      })
      .from(projectInfo)
      .where(and(
        inArray(projectInfo.opportunityId, opportunityIds),
        isNull(projectInfo.deletedAt),
      ))
      .groupBy(projectInfo.opportunityId);
    return rows.map((r: { opportunityId: number | null; count: number }) => ({
      opportunityId: r.opportunityId,
      count: Number(r.count || 0),
    }));
  }

  async getEngineeringTicketCounts(opportunityIds: number[]): Promise<CountByOpportunity[]> {
    const rows = await db
      .select({
        opportunityId: pdTickets.opportunityId,
        count: sql<number>`count(*)`,
      })
      .from(pdTickets)
      .where(and(
        inArray(pdTickets.opportunityId, opportunityIds),
        inArray(pdTickets.requestType, [...ENGINEERING_REQUEST_TYPES]),
      ))
      .groupBy(pdTickets.opportunityId);
    return rows.map((r: { opportunityId: number | null; count: number }) => ({
      opportunityId: r.opportunityId,
      count: Number(r.count || 0),
    }));
  }

  // ---- Mapping-context queries ----

  async getOpportunityWithClient(opportunityId: number): Promise<MappingContextOpportunity | undefined> {
    const [row] = await db
      .select({
        id: opportunities.id,
        pipedriveDealId: opportunities.pipedriveDealId,
        source: opportunities.source,
        notes: opportunities.notes,
        stage: opportunities.stage,
        status: opportunities.status,
        signedDate: opportunities.signedDate,
        clientId: opportunities.clientId,
        clientName: clients.name,
      })
      .from(opportunities)
      .leftJoin(clients, eq(clients.id, opportunities.clientId))
      .where(eq(opportunities.id, opportunityId));
    return row ?? undefined;
  }

  async getLinkedProject(opportunityId: number): Promise<LinkedProject | undefined> {
    const [row] = await db
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        clientId: projectInfo.clientId,
      })
      .from(projectInfo)
      .where(and(eq(projectInfo.opportunityId, opportunityId), isNull(projectInfo.deletedAt)))
      .orderBy(desc(projectInfo.id));
    return row ?? undefined;
  }

  async findLikelyClients(searchTerm: string): Promise<LikelyClient[]> {
    if (!searchTerm) return [];
    // Escape LIKE wildcards in user-derived search terms
    const escaped = searchTerm.replace(/[%_]/g, "\\$&");
    return db
      .select({ id: clients.id, name: clients.name, clientId: clients.clientId })
      .from(clients)
      .where(ilike(clients.name, `%${escaped}%`))
      .orderBy(asc(clients.name))
      .limit(10);
  }

  async findLikelyProjects(searchTerm: string): Promise<LikelyProject[]> {
    if (!searchTerm) return [];
    const escaped = searchTerm.replace(/[%_]/g, "\\$&");
    return db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName, clientId: projectInfo.clientId })
      .from(projectInfo)
      .where(and(
        ilike(projectInfo.projectName, `%${escaped}%`),
        isNull(projectInfo.deletedAt),
      ))
      .orderBy(asc(projectInfo.projectName))
      .limit(10);
  }

  async countEngineeringTickets(opportunityId: number): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(pdTickets)
      .where(and(
        eq(pdTickets.opportunityId, opportunityId),
        inArray(pdTickets.requestType, [...ENGINEERING_REQUEST_TYPES]),
      ));
    return Number(row?.count || 0);
  }

  // ---- Phase templates ----

  async getActivePhaseTemplates(): Promise<(ActivePhaseTemplate & { itemCount: number })[]> {
    const templates = await db
      .select({
        id: phaseTemplate.id,
        phase: phaseTemplate.phase,
        name: phaseTemplate.name,
        version: phaseTemplate.version,
      })
      .from(phaseTemplate)
      .where(and(eq(phaseTemplate.isActive, true), isNull(phaseTemplate.deletedAt)))
      .orderBy(asc(phaseTemplate.phase), asc(phaseTemplate.name));

    if (templates.length === 0) return [];

    const templateIds = templates.map((t: ActivePhaseTemplate) => t.id);
    const itemCounts = await db
      .select({
        templateId: phaseTemplateItem.templateId,
        count: sql<number>`count(*)`,
      })
      .from(phaseTemplateItem)
      .where(and(
        inArray(phaseTemplateItem.templateId, templateIds),
        eq(phaseTemplateItem.isDeleted, false),
      ))
      .groupBy(phaseTemplateItem.templateId);

    const byTemplateId = new Map<number, number>();
    for (const row of itemCounts) byTemplateId.set(Number(row.templateId), Number(row.count || 0));

    return templates.map((t: ActivePhaseTemplate) => ({ ...t, itemCount: byTemplateId.get(t.id) || 0 }));
  }

  async getPhaseTemplateById(templateId: number): Promise<ActivePhaseTemplate | undefined> {
    const [row] = await db
      .select({ id: phaseTemplate.id, phase: phaseTemplate.phase, name: phaseTemplate.name, version: phaseTemplate.version })
      .from(phaseTemplate)
      .where(and(eq(phaseTemplate.id, templateId), eq(phaseTemplate.isActive, true), isNull(phaseTemplate.deletedAt)));
    return row ?? undefined;
  }

  async getTemplateItems(templateId: number): Promise<TemplateItemRow[]> {
    return db
      .select({
        id: phaseTemplateItem.id,
        title: phaseTemplateItem.title,
        description: phaseTemplateItem.description,
        defaultPriority: phaseTemplateItem.defaultPriority,
        offsetDaysFromPhaseStart: phaseTemplateItem.offsetDaysFromPhaseStart,
        isDeleted: phaseTemplateItem.isDeleted,
      })
      .from(phaseTemplateItem)
      .where(and(eq(phaseTemplateItem.templateId, templateId), eq(phaseTemplateItem.isDeleted, false)))
      .orderBy(asc(phaseTemplateItem.sortOrder));
  }

  // ---- Entity lookups ----

  async getOpportunityById(opportunityId: number): Promise<Opportunity | undefined> {
    const [row] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
    return row ?? undefined;
  }

  /**
   * Unified opportunity workflow read used by the new merged
   * Opportunity drawer (2026-04-20). Returns the CRM record (Pipedrive
   * truth) plus its 1:1 PD shadow row. If the shadow does not yet exist,
   * one is lazy-created with sensible defaults the first time someone
   * opens the opportunity. The lazy-create is what lets us treat
   * "Pipedrive Opportunity" and "PD Ticket" as a single user-facing
   * concept without back-filling a row for every imported deal.
   */
  async getOpportunityWithWorkflow(opportunityId: number, actingUserId: number | null) {
    const [opp] = await db
      .select({
        opp: opportunities,
        clientName: clients.name,
        siteName: sites.siteName,
      })
      .from(opportunities)
      .leftJoin(clients, eq(clients.id, opportunities.clientId))
      .leftJoin(sites, eq(sites.id, opportunities.siteId))
      .where(eq(opportunities.id, opportunityId));
    if (!opp) return null;

    // Race-safe lazy shadow create: relies on the partial unique index
    // `pd_tickets_opportunity_id_unique` (migrations/20260420_pd_tickets_opportunity_unique.sql)
    // — concurrent inserts collapse to a single row via onConflictDoNothing,
    // then we re-select the canonical row.
    const projectSiteName =
      opp.siteName ||
      opp.clientName ||
      opp.opp.dealName ||
      `Opportunity #${opp.opp.id}`;
    await db
      .insert(pdTickets)
      .values({
        opportunityId,
        clientId: opp.opp.clientId ?? null,
        clientNameSnapshot: opp.clientName ?? null,
        projectSiteName,
        requestType: "Cost Proposal",
        priority: "Medium",
        status: "Draft",
        fundingType: opp.opp.fundingType ?? null,
        sizeKwp: opp.opp.estimatedKwp ?? null,
        estimatedProjectValue: opp.opp.estimatedValue ?? null,
        createdBy: actingUserId,
      })
      .onConflictDoNothing({ target: pdTickets.opportunityId });

    const [shadow] = await db
      .select()
      .from(pdTickets)
      .where(eq(pdTickets.opportunityId, opportunityId))
      .limit(1);
    if (!shadow) {
      throw new Error(`PD shadow vanished for opportunity #${opportunityId}`);
    }

    const tasks = await db
      .select({
        id: workItems.id,
        title: workItems.title,
        status: workItems.status,
        priority: workItems.priority,
        endDate: workItems.endDate,
      })
      .from(workItems)
      .where(eq(workItems.pdTicketId, shadow.id))
      .orderBy(asc(workItems.sortOrder));

    return {
      crm: opp.opp,
      clientName: opp.clientName,
      siteName: opp.siteName,
      pd: shadow,
      tasks,
    };
  }

  /**
   * PD-side update used by `PATCH /api/opportunities/:id/pd`.
   * Whitelists the columns that belong to the PD workflow so we can
   * never accidentally let a UI submit overwrite Pipedrive truth.
   */
  async updatePdShadow(
    opportunityId: number,
    fields: Partial<Pick<
      typeof pdTickets.$inferInsert,
      | "requestType"
      | "priority"
      | "status"
      | "dueDate"
      | "projectDeveloperUserId"
      | "designerUserId"
      | "billsOrTariffData"
      | "meteringDataAvailable"
      | "siteInspectionForm"
      | "siteInspectionLink"
      | "batteriesNeeded"
      | "batterySize"
      | "dieselGenIntegration"
      | "roofReplacementNeeded"
      | "hseDiscussed"
      | "comments"
      | "estimatedCost"
      | "estimatedMargin"
      | "estimatedMarginPercent"
      | "financialNotes"
    >>,
  ): Promise<PdTicket | null> {
    const [existing] = await db
      .select()
      .from(pdTickets)
      .where(eq(pdTickets.opportunityId, opportunityId))
      .orderBy(desc(pdTickets.id))
      .limit(1);
    if (!existing) return null;
    const [updated] = await db
      .update(pdTickets)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(pdTickets.id, existing.id))
      .returning();
    return updated ?? null;
  }

  async getOpportunityCore(opportunityId: number) {
    const [row] = await db
      .select({
        id: opportunities.id,
        source: opportunities.source,
        status: opportunities.status,
        stage: opportunities.stage,
        signedDate: opportunities.signedDate,
        deletedAt: opportunities.deletedAt,
      })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId));
    return row ?? undefined;
  }

  async getClientById(clientId: number): Promise<ClientRow | undefined> {
    const [row] = await db
      .select({ id: clients.id, name: clients.name, clientId: clients.clientId })
      .from(clients)
      .where(eq(clients.id, clientId));
    return row ?? undefined;
  }

  async getProjectById(projectId: number): Promise<LinkedProject | undefined> {
    const [row] = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName, clientId: projectInfo.clientId })
      .from(projectInfo)
      .where(and(eq(projectInfo.id, projectId), isNull(projectInfo.deletedAt)));
    return row ?? undefined;
  }

  async findClientByNameExact(name: string): Promise<ClientRow | undefined> {
    const [row] = await db
      .select({ id: clients.id, name: clients.name, clientId: clients.clientId })
      .from(clients)
      .where(ilike(clients.name, name));
    return row ?? undefined;
  }

  async findProjectByNameExact(name: string): Promise<LinkedProject | undefined> {
    const [row] = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName, clientId: projectInfo.clientId })
      .from(projectInfo)
      .where(and(eq(projectInfo.projectName, name), isNull(projectInfo.deletedAt)));
    return row ?? undefined;
  }

  // ---- Same-phase duplicate count ----

  async countSamePhaseTickets(opportunityId: number, projectId: number, phase: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(pdTickets)
      .where(and(
        eq(pdTickets.opportunityId, opportunityId),
        eq(pdTickets.projectId, projectId),
        eq(pdTickets.requestType, phase),
      ));
    return Number(row?.count || 0);
  }

  // ---- Mutations (used inside transactions) ----

  async insertPdTicket(tx: typeof db, values: Record<string, unknown>): Promise<PdTicket> {
    const [ticket] = await tx.insert(pdTickets).values(values as typeof pdTickets.$inferInsert).returning();
    return ticket;
  }

  async insertProjectShell(tx: typeof db, values: Record<string, unknown>) {
    const [created] = await tx.insert(projectInfo).values(values as typeof projectInfo.$inferInsert).returning();
    return created;
  }

  async insertPhaseHistory(tx: typeof db, values: {
    projectId: number;
    fromPhase: string | null;
    toPhase: string;
    changedByUserId: number | null;
    reason: string;
  }) {
    await tx.insert(projectPhaseHistory).values(values);
  }

  async updateOpportunityClient(tx: typeof db, opportunityId: number, clientId: number) {
    await tx
      .update(opportunities)
      .set({ clientId, updatedAt: new Date() })
      .where(eq(opportunities.id, opportunityId));
  }

  // ---- Intake page combined queries ----

  async getIntakeOpportunities(): Promise<IntakeOpportunityRow[]> {
    return db
      .select({
        id: opportunities.id,
        pipedriveDealId: opportunities.pipedriveDealId,
        source: opportunities.source,
        stage: opportunities.stage,
        status: opportunities.status,
        estimatedValue: opportunities.estimatedValue,
        expectedCloseDate: opportunities.expectedCloseDate,
        signedDate: opportunities.signedDate,
        notes: opportunities.notes,
        updatedAt: opportunities.updatedAt,
        createdAt: opportunities.createdAt,
        clientId: opportunities.clientId,
        clientName: clients.name,
      })
      .from(opportunities)
      .leftJoin(clients, eq(clients.id, opportunities.clientId))
      .where(and(
        isNull(opportunities.deletedAt),
        eq(opportunities.source, "pipedrive"),
      ))
      .orderBy(desc(opportunities.updatedAt));
  }

  async getIntakeTickets(): Promise<IntakeTicketRow[]> {
    const rows = await db
      .select({
        id: pdTickets.id,
        opportunityId: pdTickets.opportunityId,
        clientId: pdTickets.clientId,
        projectId: pdTickets.projectId,
        projectSiteName: pdTickets.projectSiteName,
        requestType: pdTickets.requestType,
        priority: pdTickets.priority,
        status: pdTickets.status,
        dueDate: pdTickets.dueDate,
        tasksSpawnedAt: pdTickets.tasksSpawnedAt,
        createdAt: pdTickets.createdAt,
        updatedAt: pdTickets.updatedAt,
        projectDeveloperUserId: pdTickets.projectDeveloperUserId,
        clientName: clients.name,
        projectName: projectInfo.projectName,
        developerName: users.name,
        subTasksTotal: sql<number>`count(distinct ${workItems.id})`,
        subTasksDone: sql<number>`count(distinct ${workItems.id}) filter (where ${workItems.status} in ('Completed', 'DONE', 'Done'))`,
        nextAction: sql<string | null>`max(${workItems.nextStep})`,
      })
      .from(pdTickets)
      .leftJoin(clients, eq(clients.id, pdTickets.clientId))
      .leftJoin(projectInfo, eq(projectInfo.id, pdTickets.projectId))
      .leftJoin(users, eq(users.id, pdTickets.projectDeveloperUserId))
      .leftJoin(workItems, and(
        eq(workItems.pdTicketId, pdTickets.id),
        isNull(workItems.deletedAt),
      ))
      .groupBy(
        pdTickets.id,
        clients.name,
        projectInfo.projectName,
        users.name,
      )
      .orderBy(desc(pdTickets.updatedAt));
    return rows.map((r: typeof rows[number]): IntakeTicketRow => ({
      ...r,
      subTasksTotal: Number(r.subTasksTotal || 0),
      subTasksDone: Number(r.subTasksDone || 0),
    }));
  }

  async getIntakeStats() {
    const today = new Date().toISOString().split("T")[0];

    const [oppStats] = await db
      .select({
        total: sql<number>`count(*)`,
        unconverted: sql<number>`count(*) filter (where ${opportunities.status} not in ('won','lost') and ${opportunities.signedDate} is null)`,
        won: sql<number>`count(*) filter (where ${opportunities.status} = 'won')`,
        lost: sql<number>`count(*) filter (where ${opportunities.status} = 'lost')`,
      })
      .from(opportunities)
      .where(and(isNull(opportunities.deletedAt), eq(opportunities.source, "pipedrive")));

    const [ticketStats] = await db
      .select({
        total: sql<number>`count(*)`,
        inProgress: sql<number>`count(*) filter (where ${pdTickets.status} = 'In Progress')`,
        overdue: sql<number>`count(*) filter (where ${pdTickets.dueDate} < ${today} and ${pdTickets.status} not in ('Completed','Cancelled'))`,
        completed: sql<number>`count(*) filter (where ${pdTickets.status} = 'Completed')`,
      })
      .from(pdTickets);

    return {
      opportunities: {
        total: Number(oppStats?.total || 0),
        unconverted: Number(oppStats?.unconverted || 0),
        won: Number(oppStats?.won || 0),
        lost: Number(oppStats?.lost || 0),
      },
      tickets: {
        total: Number(ticketStats?.total || 0),
        inProgress: Number(ticketStats?.inProgress || 0),
        overdue: Number(ticketStats?.overdue || 0),
        completed: Number(ticketStats?.completed || 0),
      },
    };
  }

  // ---- Legacy CRUD (unchanged) ----

  async listOpportunities(filters: { clientId?: number; stage?: string }) {
    const conditions = [isNull(opportunities.deletedAt)];
    if (filters.clientId) conditions.push(eq(opportunities.clientId, filters.clientId));
    if (filters.stage) conditions.push(eq(opportunities.stage, filters.stage));
    return db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
  }

  async createOpportunity(values: typeof opportunities.$inferInsert): Promise<Opportunity> {
    const [row] = await db.insert(opportunities).values(values).returning();
    return row;
  }

  async updateOpportunity(id: number, fields: Partial<typeof opportunities.$inferInsert>): Promise<Opportunity | undefined> {
    const [row] = await db
      .update(opportunities)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning();
    return row ?? undefined;
  }

  async softDeleteOpportunity(id: number): Promise<Opportunity | undefined> {
    const [row] = await db
      .update(opportunities)
      .set({ deletedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning();
    return row ?? undefined;
  }
}

export const opportunitiesRepo = new OpportunitiesRepository();
