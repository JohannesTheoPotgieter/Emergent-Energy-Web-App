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
  updatedAt: Date | null;
  clientId: number | null;
  clientName: string | null;
  dealOwnerUserId: number | null;
  dealOwnerName: string | null;
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
        updatedAt: opportunities.updatedAt,
        clientId: opportunities.clientId,
        clientName: clients.name,
        dealOwnerUserId: opportunities.dealOwnerUserId,
        dealOwnerName: users.name,
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
    return rows.map(r => ({ opportunityId: r.opportunityId, count: Number(r.count || 0) }));
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
    return rows.map(r => ({ opportunityId: r.opportunityId, count: Number(r.count || 0) }));
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

    const templateIds = templates.map(t => t.id);
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

    return templates.map(t => ({ ...t, itemCount: byTemplateId.get(t.id) || 0 }));
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
