import { eq, desc, isNull, and, inArray, sql, ilike, asc } from "drizzle-orm";
import { alias as aliasedTable } from "drizzle-orm/pg-core";
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
  estimatedValue: string | null;
  estimatedKwp: string | null;
  fundingType: string | null;
  province: string | null;
  nextActivityDate: string | Date | null;
  nextActivitySubject: string | null;
  pdProvince: string | null;
  pdProjectDeveloperUserId: number | null;
  pdProjectDeveloperUserName: string | null;
}

interface CountByOpportunity {
  opportunityId: number | null;
  count: number;
}

/**
 * Richer per-opportunity ticket summary used by the working list to
 * display Open/Closed split + days-in-progress, and to skip the
 * mapping dialog when an opportunity already has tickets (in which
 * case the latest ticket's client/project is the obvious default).
 */
export interface EngineeringTicketSummary {
  opportunityId: number;
  openCount: number;
  closedCount: number;
  oldestOpenAt: Date | null;
  lastTicketClientId: number | null;
  lastTicketProjectId: number | null;
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
    // Aliases so we can join `users` twice — once for the Pipedrive deal owner
    // (CRM side) and once for the in-app project developer override (PD side).
    const dealOwnerUser = aliasedTable(users, "deal_owner_user");
    const projectDeveloperUser = aliasedTable(users, "project_developer_user");

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
        dealOwnerUserName: dealOwnerUser.name,
        dealOwnerNameSnapshot: opportunities.dealOwnerName,
        siteId: opportunities.siteId,
        siteName: sites.siteName,
        siteAddress: sites.address,
        // Management-board columns (2026-04-20):
        estimatedValue: opportunities.estimatedValue,
        estimatedKwp: opportunities.estimatedKwp,
        fundingType: opportunities.fundingType,
        province: opportunities.province,
        nextActivityDate: opportunities.nextActivityDate,
        nextActivitySubject: opportunities.nextActivitySubject,
        // PD-shadow override fields:
        pdProvince: pdTickets.province,
        pdProjectDeveloperUserId: pdTickets.projectDeveloperUserId,
        pdProjectDeveloperUserName: projectDeveloperUser.name,
      })
      .from(opportunities)
      .leftJoin(clients, eq(clients.id, opportunities.clientId))
      .leftJoin(dealOwnerUser, eq(dealOwnerUser.id, opportunities.dealOwnerUserId))
      .leftJoin(sites, eq(sites.id, opportunities.siteId))
      // Safe to leftJoin without aggregation: `pd_tickets_opportunity_shadow_unique`
      // enforces 1:1 between opportunities ↔ pd_tickets shadow rows (partial unique
      // index where opportunity_id IS NOT NULL AND project_id IS NULL).
      .leftJoin(pdTickets, eq(pdTickets.opportunityId, opportunities.id))
      .leftJoin(projectDeveloperUser, eq(projectDeveloperUser.id, pdTickets.projectDeveloperUserId))
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

  /**
   * Returns the (first) linked project for each opportunity so the UI can
   * deep-link the "Eng" count badge to the project page where tickets and
   * progress live. Used by the Opportunities working list to power the
   * progress-tracking jump-link.
   */
  async getLinkedProjectsByOpportunity(opportunityIds: number[]): Promise<Array<{ opportunityId: number; projectId: number; projectName: string | null }>> {
    if (opportunityIds.length === 0) return [];
    const rows = await db
      .select({
        opportunityId: projectInfo.opportunityId,
        projectId: projectInfo.id,
        projectName: projectInfo.projectName,
      })
      .from(projectInfo)
      .where(and(
        inArray(projectInfo.opportunityId, opportunityIds),
        isNull(projectInfo.deletedAt),
      ))
      .orderBy(projectInfo.id);
    const seen = new Set<number>();
    const out: Array<{ opportunityId: number; projectId: number; projectName: string | null }> = [];
    for (const r of rows) {
      const oid = r.opportunityId;
      if (oid == null || seen.has(oid)) continue;
      seen.add(oid);
      out.push({ opportunityId: oid, projectId: r.projectId, projectName: r.projectName ?? null });
    }
    return out;
  }

  /**
   * Richer per-opportunity ticket summary. Returns:
   *   - openCount: tickets not in Completed/Cancelled
   *   - closedCount: tickets in Completed/Cancelled
   *   - oldestOpenAt: created_at of the oldest still-open ticket
   *   - lastTicketClientId / lastTicketProjectId: from the most recent
   *     ticket of any status, used by the UI to skip the mapping
   *     dialog when an opportunity already has tickets.
   *
   * Reads pd_tickets only — no writes, no schema changes.
   */
  async getEngineeringTicketSummaries(
    opportunityIds: number[],
  ): Promise<EngineeringTicketSummary[]> {
    if (opportunityIds.length === 0) return [];
    const rows = await db
      .select({
        opportunityId: pdTickets.opportunityId,
        status: pdTickets.status,
        createdAt: pdTickets.createdAt,
        clientId: pdTickets.clientId,
        projectId: pdTickets.projectId,
      })
      .from(pdTickets)
      .where(inArray(pdTickets.opportunityId, opportunityIds))
      .orderBy(desc(pdTickets.createdAt));
    const TERMINAL = new Set(["Completed", "Cancelled"]);
    const byOpp = new Map<number, EngineeringTicketSummary>();
    for (const r of rows) {
      const oid = r.opportunityId;
      if (oid == null) continue;
      let s = byOpp.get(oid);
      if (!s) {
        s = {
          opportunityId: oid,
          openCount: 0,
          closedCount: 0,
          oldestOpenAt: null,
          lastTicketClientId: null,
          lastTicketProjectId: null,
        };
        byOpp.set(oid, s);
      }
      // Prefer the most recent ticket that has BOTH client and project set
      // as the skip-mapping default. Rows are ordered DESC by createdAt, so
      // the first qualifying row wins; an unlinked shadow ticket at the top
      // (projectId null) is skipped in favor of an older fully-mapped one.
      if (
        s.lastTicketClientId == null &&
        s.lastTicketProjectId == null &&
        r.clientId != null &&
        r.projectId != null
      ) {
        s.lastTicketClientId = r.clientId;
        s.lastTicketProjectId = r.projectId;
      }
      const isClosed = TERMINAL.has(r.status || "");
      if (isClosed) {
        s.closedCount += 1;
      } else {
        s.openCount += 1;
        if (r.createdAt && (!s.oldestOpenAt || r.createdAt < s.oldestOpenAt)) {
          s.oldestOpenAt = r.createdAt;
        }
      }
    }
    return Array.from(byOpp.values());
  }

  async getEngineeringTicketCounts(opportunityIds: number[]): Promise<CountByOpportunity[]> {
    // Counts pd_tickets attached to each opportunity that are still OPEN —
    // i.e. not Completed or Cancelled. This is the "engineering tasks open"
    // metric surfaced on the Opportunities management board.
    //
    // We intentionally do NOT filter by `pd_tickets.request_type` here. The
    // request_type field is a free-form string supplied by the convert /
    // create-engineering-tickets flow (`parsed.customTicket.phase` and the
    // per-draft `requestType`), so any phase template name a PD types in is
    // valid. The legacy `ENGINEERING_REQUEST_TYPES` allowlist
    // ("Feasibility Study", "Design Review", "IFC Planning", …) doesn't match
    // the names actually flowing through this UI ("First Assessment",
    // "Cost Proposal", "Site visit Report", …) and silently zeroed the badge.
    // On the Opportunities board, every pd_ticket attached to an opportunity
    // IS engineering work, so the opp-scope alone is the correct filter.
    const rows = await db
      .select({
        opportunityId: pdTickets.opportunityId,
        count: sql<number>`count(*)`,
      })
      .from(pdTickets)
      .where(and(
        inArray(pdTickets.opportunityId, opportunityIds),
        sql`${pdTickets.status} NOT IN ('Completed', 'Cancelled')`,
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
    // Single-opportunity counterpart to `getEngineeringTicketCounts`. We
    // intentionally drop the `ENGINEERING_REQUEST_TYPES` allowlist filter for
    // the same reason — the convert / create-engineering-tickets flow writes
    // free-form `request_type` values ("First Assessment", "Cost Proposal",
    // "Site visit Report", …) that don't match the legacy hardcoded list, so
    // filtering here would silently zero the count and the two methods would
    // disagree across views (working list vs. drawer / detail).
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(pdTickets)
      .where(eq(pdTickets.opportunityId, opportunityId));
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
    // `pd_tickets_opportunity_shadow_unique` ON pd_tickets (opportunity_id)
    // WHERE opportunity_id IS NOT NULL AND project_id IS NULL.
    // Postgres requires the inference clause to repeat the predicate of a
    // partial unique index, otherwise it raises 42P10 "no unique or
    // exclusion constraint matching the ON CONFLICT specification".
    // We only ever lazy-create unlinked shadows here (project_id is always
    // NULL on insert), so the predicate is satisfied by construction.
    //
    // IMPORTANT: Drizzle's `onConflictDoNothing` only emits the predicate
    // when passed via the (deprecated-but-functional) `where` key. The
    // `targetWhere` property is silently ignored on DoNothing — it is only
    // wired up for `onConflictDoUpdate`. See node_modules/drizzle-orm/
    // pg-core/query-builders/insert.js (DoNothing branch uses `whereSql`).
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
      .onConflictDoNothing({
        target: pdTickets.opportunityId,
        where: sql`opportunity_id IS NOT NULL AND project_id IS NULL`,
      });

    // Constrain re-select to the canonical shadow scope (project_id IS NULL)
    // so we always return the row covered by the partial unique index, not
    // an unrelated project-linked PD ticket that may share the opportunity.
    const [shadow] = await db
      .select()
      .from(pdTickets)
      .where(and(eq(pdTickets.opportunityId, opportunityId), isNull(pdTickets.projectId)))
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

    // All engineering tickets attached to this opportunity. We INCLUDE the
    // lazy shadow row here (rather than excluding it) because the partial
    // unique index `pd_tickets_opportunity_shadow_unique` guarantees there
    // is exactly one row per opportunity with project_id IS NULL — and
    // that row IS the engineering intake ticket the user has been editing
    // through the PD form above. Filtering it out caused opportunities
    // that have a real, in-progress engineering ticket but no separate
    // project-linked ticket to render as "No engineering tickets yet"
    // (see prod opp #247 / Steelcorp 54 Moore Road, which had exactly
    // one ticket #28 and no project link). For each ticket we surface
    // enough to render a tracking row: status, request type, priority,
    // due date, owner names, linked project.
    const pdUser = aliasedTable(users, "pd_user");
    const designUser = aliasedTable(users, "design_user");
    const tickets = await db
      .select({
        id: pdTickets.id,
        status: pdTickets.status,
        requestType: pdTickets.requestType,
        priority: pdTickets.priority,
        dueDate: pdTickets.dueDate,
        comments: pdTickets.comments,
        createdAt: pdTickets.createdAt,
        updatedAt: pdTickets.updatedAt,
        clientId: pdTickets.clientId,
        projectId: pdTickets.projectId,
        projectName: projectInfo.projectName,
        tasksSpawnedAt: pdTickets.tasksSpawnedAt,
        projectDeveloperUserId: pdTickets.projectDeveloperUserId,
        projectDeveloperName: pdUser.name,
        designerUserId: pdTickets.designerUserId,
        designerName: designUser.name,
      })
      .from(pdTickets)
      .leftJoin(projectInfo, eq(projectInfo.id, pdTickets.projectId))
      .leftJoin(pdUser, eq(pdUser.id, pdTickets.projectDeveloperUserId))
      .leftJoin(designUser, eq(designUser.id, pdTickets.designerUserId))
      .where(eq(pdTickets.opportunityId, opportunityId))
      .orderBy(desc(pdTickets.createdAt));

    // Project-level task board for the drawer. The board is rendered once
    // per project (not per ticket) — every engineering ticket's spawned
    // work_items end up on the same project, so grouping them at the
    // project level is the more honest view. Each ticket itself is also
    // surfaced as a board column-header chip so users can see which
    // tasks came from which ticket. Owner name prefers the joined
    // users.name, falling back to the denormalized work_items.owner_name.
    type ProjectTask = {
      id: number;
      pdTicketId: number | null;
      title: string;
      status: string;
      phase: string | null;
      priority: string | null;
      endDate: string | null;
      percentComplete: number | null;
      ownerUserId: number | null;
      ownerName: string | null;
      sortOrder: number | null;
    };
    type TicketRow = (typeof tickets)[number];
    const linkedProjectId =
      tickets.find((t: TicketRow) => t.projectId != null)?.projectId ?? null;
    let projectTasks: ProjectTask[] = [];
    if (linkedProjectId != null) {
      const ownerUser = aliasedTable(users, "wi_owner_user");
      projectTasks = (await db
        .select({
          id: workItems.id,
          pdTicketId: workItems.pdTicketId,
          title: workItems.title,
          status: workItems.status,
          phase: workItems.phase,
          priority: workItems.priority,
          endDate: workItems.endDate,
          percentComplete: workItems.percentComplete,
          ownerUserId: workItems.ownerUserId,
          ownerName: sql<string | null>`COALESCE(${ownerUser.name}, ${workItems.ownerName})`,
          sortOrder: workItems.sortOrder,
        })
        .from(workItems)
        .leftJoin(ownerUser, eq(ownerUser.id, workItems.ownerUserId))
        .where(
          and(
            eq(workItems.projectId, linkedProjectId),
            isNull(workItems.deletedAt),
          ),
        )
        .orderBy(asc(workItems.sortOrder), asc(workItems.id))) as ProjectTask[];
    }

    return {
      crm: opp.opp,
      clientName: opp.clientName,
      siteName: opp.siteName,
      pd: shadow,
      tasks,
      tickets,
      projectTasks,
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

  /**
   * Back-link an existing (non-shell) project to an opportunity. Only writes
   * when `project_info.opportunity_id` is currently NULL — never clobbers a
   * link to a different opportunity. Returns true if a row was updated.
   *
   * Used by the resolve-mapping flow's `existing_existing` and `existing_new`
   * (with picked existing project) branches so the opportunity drops off the
   * Opportunities working list as "converted" once a real project is paired
   * with it. Without this back-link the opp stays "active" forever even
   * though pd_tickets are pointing at the chosen project.
   */
  async linkProjectToOpportunityIfUnset(tx: typeof db, projectId: number, opportunityId: number): Promise<boolean> {
    const result = await tx
      .update(projectInfo)
      .set({ opportunityId })
      .where(and(eq(projectInfo.id, projectId), isNull(projectInfo.opportunityId)))
      .returning({ id: projectInfo.id });
    return result.length > 0;
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
