/**
 * B3: Opportunities CRUD routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { eq, desc, isNull, and, inArray, sql, ilike, asc } from "drizzle-orm";
import { opportunities, clients, projectInfo, sites, pdTickets, projectPhaseHistory, phaseTemplate, phaseTemplateItem } from "@shared/schema/projects";
import { users } from "@shared/schema/users";
import { z, ZodError } from "zod";
import { logAuditFromReq } from "../audit-logger";
import { ENGINEERING_REQUEST_TYPES, canCreatePdTicket } from "@shared/roles/pd-roles";
import { isActivePdWorkingOpportunity, isOpportunityIntakeTerminal } from "../lib/opportunity-working-filter";
import { insertClientWithGeneratedId } from "../lib/client-id-generator";
import { syncProjectSplitTablesAfterInsert } from "../lib/project-info-sync";
import { buildOpportunityMappingPlan } from "../lib/opportunity-mapping-plan";
import { buildCustomComments, buildSamePhaseDuplicateWarning, buildTemplateTicketDrafts } from "../lib/opportunity-engineering-ticket-flow";

// Validation for user-driven opportunity create/update. Intentionally
// narrower than the raw table schema:
//   - `pipedriveDealId` is NOT accepted — only the Pipedrive sync engine
//     writes that column.
//   - `source` is accepted but restricted to 'internal' on the create
//     path; flipping a row to 'pipedrive' is reserved for the sync engine.
//   - The old `name` field that this schema used to accept has been
//     dropped because the `opportunities` table has no `name` column.
//     It was being silently ignored by drizzle and leaking validation
//     errors when clients guessed at the shape.
const opportunityCreateSchema = z.object({
  clientId: z.number().int().optional(),
  siteId: z.number().int().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
  contractType: z.string().optional(),
  estimatedValue: z.union([z.string(), z.number()]).optional(),
  estimatedKwp: z.union([z.string(), z.number()]).optional(),
  estimatedKwh: z.union([z.string(), z.number()]).optional(),
  expectedCloseDate: z.string().optional(),
  signedDate: z.string().optional(),
  notes: z.string().optional(),
  fundingType: z.string().optional(),
  commercialRisks: z.string().optional(),
  source: z.literal("internal").optional(),
});

const router = Router();

const OPPORTUNITY_INTAKE_VIEW_ROLES = ["PROJECT_DEVELOPER", "COO_ADMIN", "CEO_ADMIN", "CCO"] as const;
function canViewOpportunityIntake(role: string): boolean {
  return (OPPORTUNITY_INTAKE_VIEW_ROLES as readonly string[]).includes(role);
}

function canMutateOpportunityIntake(role: string): boolean {
  return canCreatePdTicket(role);
}

const engineeringTicketCreateSchema = z.object({
  mode: z.enum(["phase_template", "custom"]),
  clientId: z.number().int(),
  projectId: z.number().int(),
  phaseTemplateId: z.number().int().optional(),
  templateBaseDueDate: z.string().trim().optional(),
  customTicket: z.object({
    title: z.string().trim().min(1),
    phase: z.string().trim().min(1),
    descriptionScope: z.string().trim().min(1),
    dueDate: z.string().trim().min(1),
    priority: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium"),
    requiredOutput: z.string().trim().min(1),
  }).optional(),
});

const mappingResolveSchema = z.object({
  mode: z.enum(["existing_existing", "existing_new", "new_new"]),
  existingClientId: z.number().int().optional(),
  existingProjectId: z.number().int().optional(),
  newClientName: z.string().trim().optional(),
  newProjectName: z.string().trim().optional(),
  confirmDuplicates: z.boolean().optional().default(false),
});

/**
 * PD working-list read model.
 * Designed for the Opportunities working view and future "Create Engineering Ticket" action.
 */
router.get("/api/opportunities/working", requireAuth, requirePermission("opportunities", "view"), async (_req: Request, res: Response) => {
  try {
    const role = String((_req.user as any)?.companyRole || (_req.user as any)?.role || "");
    if (!canViewOpportunityIntake(role)) {
      return res.status(403).json({ error: "Opportunities intake view is limited to Project Development and admin oversight roles." });
    }
    const rows = await db
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

    const opportunityIds = rows.map((r: any) => r.id);
    if (opportunityIds.length === 0) return res.json([]);

    const linkedProjectCounts = await db
      .select({
        opportunityId: projectInfo.opportunityId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectInfo)
      .where(and(
        inArray(projectInfo.opportunityId, opportunityIds),
        isNull(projectInfo.deletedAt),
      ))
      .groupBy(projectInfo.opportunityId);

    const engineeringTicketCounts = await db
      .select({
        opportunityId: pdTickets.opportunityId,
        count: sql<number>`count(*)::int`,
      })
      .from(pdTickets)
      .where(and(
        inArray(pdTickets.opportunityId, opportunityIds),
        inArray(pdTickets.requestType, [...ENGINEERING_REQUEST_TYPES]),
      ))
      .groupBy(pdTickets.opportunityId);

    const projectCountByOpportunity = new Map<number, number>();
    for (const r of linkedProjectCounts as any[]) {
      if (r.opportunityId != null) projectCountByOpportunity.set(r.opportunityId, Number(r.count || 0));
    }

    const engineeringTicketCountByOpportunity = new Map<number, number>();
    for (const r of engineeringTicketCounts as any[]) {
      if (r.opportunityId != null) engineeringTicketCountByOpportunity.set(r.opportunityId, Number(r.count || 0));
    }

    const workingRows = rows
      .map((r: any) => {
        const linkedProjectCount = projectCountByOpportunity.get(r.id) || 0;
        const hasLinkedProject = linkedProjectCount > 0;

        const note = (r.notes || "").trim();
        const dealName = note.toLowerCase().startsWith("pipedrive:")
          ? note.replace(/^pipedrive:\s*/i, "").trim()
          : (note || `Deal #${r.pipedriveDealId || r.id}`);

        return {
          id: r.id,
          dealName,
          pipedriveDealId: r.pipedriveDealId,
          orgClientName: r.clientName || null,
          dealOwner: r.dealOwnerName || null,
          stage: r.stage || null,
          status: r.status || null,
          siteLocation: r.siteName || r.siteAddress || null,
          hasLinkedClient: Boolean(r.clientId),
          hasLinkedProject,
          linkedProjectCount,
          existingEngineeringTicketCount: engineeringTicketCountByOpportunity.get(r.id) || 0,
          lastUpdated: r.updatedAt || null,
          // Keep raw fields available for future create-action wiring.
          signedDate: r.signedDate || null,
          expectedCloseDate: r.expectedCloseDate || null,
        };
      })
      .filter((r: any) => isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: r.status,
        stage: r.stage,
        signedDate: r.signedDate,
        hasLinkedProject: r.hasLinkedProject,
      }));

    res.json(workingRows);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch PD working rows:", err);
    res.status(500).json({ error: "Failed to fetch opportunities working list" });
  }
});


router.get("/api/opportunities/:id/engineering-phase-templates", requireAuth, requirePermission("pd_tickets", "create"), async (_req: Request, res: Response) => {
  try {
    const role = String((_req.user as any)?.companyRole || (_req.user as any)?.role || "");
    if (!canViewOpportunityIntake(role)) {
      return res.status(403).json({ error: "Template inspection is limited to Project Development and admin oversight roles." });
    }
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

    if (templates.length === 0) return res.json([]);
    const templateIds = templates.map((t: any) => t.id);
    const itemCounts = await db
      .select({
        templateId: phaseTemplateItem.templateId,
        count: sql<number>`count(*)::int`,
      })
      .from(phaseTemplateItem)
      .where(and(
        inArray(phaseTemplateItem.templateId, templateIds),
        eq(phaseTemplateItem.isDeleted, false),
      ))
      .groupBy(phaseTemplateItem.templateId);

    const byTemplateId = new Map<number, number>();
    for (const row of itemCounts as any[]) byTemplateId.set(Number(row.templateId), Number(row.count || 0));

    res.json(templates.map((t: any) => ({ ...t, itemCount: byTemplateId.get(t.id) || 0 })));
  } catch (err) {
    console.error("[Opportunities] Failed to fetch engineering phase templates:", err);
    res.status(500).json({ error: "Failed to fetch engineering phase templates" });
  }
});

router.post("/api/opportunities/:id/create-engineering-tickets", requireAuth, requirePermission("pd_tickets", "create"), async (req: Request, res: Response) => {
  try {
    const role = String((req.user as any)?.companyRole || (req.user as any)?.role || "");
    if (!canMutateOpportunityIntake(role)) {
      return res.status(403).json({ error: "Engineering ticket creation authority is limited to Project Development role(s)." });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId)) return res.status(400).json({ error: "Invalid opportunity id" });
    const parsed = engineeringTicketCreateSchema.parse(req.body || {});
    const user = req.user as any;

    const [opportunity] = await db
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
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.source !== "pipedrive") {
      return res.status(400).json({ error: "Only pipedrive opportunities are supported in this flow." });
    }
    if (opportunity.deletedAt) {
      return res.status(409).json({ error: "This opportunity has been archived and cannot create tickets." });
    }
    if (isOpportunityIntakeTerminal(opportunity)) {
      return res.status(409).json({
        error: "Terminal opportunity states (lost/won/signed/closed) cannot create new engineering tickets.",
      });
    }

    const [clientRow] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, parsed.clientId));
    if (!clientRow) return res.status(404).json({ error: "Client not found" });

    const [projectRow] = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(and(eq(projectInfo.id, parsed.projectId), isNull(projectInfo.deletedAt)));
    if (!projectRow) return res.status(404).json({ error: "Project not found" });

    const createdTickets: any[] = [];
    const warnings: string[] = [];

    if (parsed.mode === "custom") {
      if (!parsed.customTicket) return res.status(400).json({ error: "customTicket payload is required for custom mode" });
      const samePhaseCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pdTickets)
        .where(and(
          eq(pdTickets.opportunityId, opportunityId),
          eq(pdTickets.projectId, parsed.projectId),
          eq(pdTickets.requestType, parsed.customTicket.phase),
        ));
      const count = Number(samePhaseCount[0]?.count || 0);
      warnings.push(...buildSamePhaseDuplicateWarning(parsed.customTicket.phase, count));

      const [ticket] = await db.insert(pdTickets).values({
        clientId: parsed.clientId,
        clientNameSnapshot: clientRow.name,
        projectId: parsed.projectId,
        opportunityId,
        projectSiteName: parsed.customTicket.title,
        requestType: parsed.customTicket.phase,
        dueDate: parsed.customTicket.dueDate,
        priority: parsed.customTicket.priority,
        status: "Draft",
        comments: buildCustomComments(parsed.customTicket),
        projectDeveloperUserId: user?.id || null,
        createdBy: user?.id || null,
      }).returning();
      createdTickets.push(ticket);

      logAuditFromReq(req, {
        entityType: "pd_ticket",
        entityId: String(ticket.id),
        action: "create_from_opportunity_custom",
        changesJson: {
          opportunityId,
          clientId: parsed.clientId,
          projectId: parsed.projectId,
          phase: parsed.customTicket.phase,
          duplicateWarning: warnings.length > 0,
          traceability: "opportunity+client+project",
        },
      });
    }

    if (parsed.mode === "phase_template") {
      if (!parsed.phaseTemplateId) return res.status(400).json({ error: "phaseTemplateId is required for phase_template mode" });
      const [template] = await db
        .select({ id: phaseTemplate.id, phase: phaseTemplate.phase, name: phaseTemplate.name, version: phaseTemplate.version })
        .from(phaseTemplate)
        .where(and(eq(phaseTemplate.id, parsed.phaseTemplateId), eq(phaseTemplate.isActive, true), isNull(phaseTemplate.deletedAt)));
      if (!template) return res.status(404).json({ error: "Active phase template not found" });

      const samePhaseCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pdTickets)
        .where(and(
          eq(pdTickets.opportunityId, opportunityId),
          eq(pdTickets.projectId, parsed.projectId),
          eq(pdTickets.requestType, template.phase),
        ));
      const count = Number(samePhaseCount[0]?.count || 0);
      warnings.push(...buildSamePhaseDuplicateWarning(template.phase, count));

      const items = await db
        .select({
          id: phaseTemplateItem.id,
          title: phaseTemplateItem.title,
          description: phaseTemplateItem.description,
          defaultPriority: phaseTemplateItem.defaultPriority,
          offsetDaysFromPhaseStart: phaseTemplateItem.offsetDaysFromPhaseStart,
          isDeleted: phaseTemplateItem.isDeleted,
        })
        .from(phaseTemplateItem)
        .where(and(eq(phaseTemplateItem.templateId, template.id), eq(phaseTemplateItem.isDeleted, false)))
        .orderBy(asc(phaseTemplateItem.sortOrder));

      if (items.length === 0) return res.status(400).json({ error: "Selected template has no active items" });
      const baseDueDate = parsed.templateBaseDueDate || new Date().toISOString().slice(0, 10);
      const ticketDrafts = buildTemplateTicketDrafts({
        templatePhase: template.phase,
        templateName: template.name,
        templateVersion: template.version,
        baseDueDate,
        items: items as any[],
      });

      for (const draft of ticketDrafts as any[]) {
        const [ticket] = await db.insert(pdTickets).values({
          clientId: parsed.clientId,
          clientNameSnapshot: clientRow.name,
          projectId: parsed.projectId,
          opportunityId,
          projectSiteName: draft.title,
          requestType: draft.requestType,
          dueDate: draft.dueDate,
          priority: draft.priority,
          status: "Draft",
          comments: draft.comments,
          projectDeveloperUserId: user?.id || null,
          createdBy: user?.id || null,
        }).returning();
        createdTickets.push(ticket);

        logAuditFromReq(req, {
          entityType: "pd_ticket",
          entityId: String(ticket.id),
          action: "create_from_opportunity_phase_template",
          changesJson: {
            opportunityId,
            clientId: parsed.clientId,
            projectId: parsed.projectId,
            phase: template.phase,
            templateId: template.id,
            templateName: template.name,
            templateVersion: template.version,
            templateItemId: draft.templateItemId,
            traceability: "opportunity+client+project",
          },
        });
      }
    }

    res.status(201).json({
      opportunityId,
      clientId: parsed.clientId,
      projectId: parsed.projectId,
      createdCount: createdTickets.length,
      createdTickets,
      warnings,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Opportunities] create engineering tickets failed:", err);
    res.status(500).json({ error: "Failed to create engineering tickets" });
  }
});

router.get("/api/opportunities/:id/mapping-context", requireAuth, requirePermission("pd_tickets", "create"), async (req: Request, res: Response) => {
  try {
    const role = String((req.user as any)?.companyRole || (req.user as any)?.role || "");
    if (!canViewOpportunityIntake(role)) {
      return res.status(403).json({ error: "Mapping inspection is limited to Project Development and admin oversight roles." });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId)) return res.status(400).json({ error: "Invalid opportunity id" });

    const [opportunity] = await db
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

    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.source !== "pipedrive") {
      return res.status(400).json({ error: "Only pipedrive opportunities are supported in this flow." });
    }
    if (isOpportunityIntakeTerminal(opportunity)) {
      return res.status(409).json({ error: "Terminal opportunity states cannot be mapped for new engineering ticket creation." });
    }

    const [linkedProject] = await db
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        clientId: projectInfo.clientId,
      })
      .from(projectInfo)
      .where(and(eq(projectInfo.opportunityId, opportunityId), isNull(projectInfo.deletedAt)))
      .orderBy(desc(projectInfo.id));

    const dealName = ((opportunity.notes || "").replace(/^pipedrive:\s*/i, "").trim() || `Deal ${opportunityId}`).slice(0, 120);

    const likelyClients = await db
      .select({ id: clients.id, name: clients.name, clientId: clients.clientId })
      .from(clients)
      .where(ilike(clients.name, `%${(opportunity.clientName || dealName).split(" ")[0]}%`))
      .orderBy(asc(clients.name))
      .limit(10);

    const likelyProjects = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName, clientId: projectInfo.clientId })
      .from(projectInfo)
      .where(and(
        ilike(projectInfo.projectName, `%${dealName.split(" ")[0]}%`),
        isNull(projectInfo.deletedAt),
      ))
      .orderBy(asc(projectInfo.projectName))
      .limit(10);

    const [existingEngineeringTicketCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pdTickets)
      .where(and(
        eq(pdTickets.opportunityId, opportunityId),
        inArray(pdTickets.requestType, [...ENGINEERING_REQUEST_TYPES]),
      ));

    logAuditFromReq(req, {
      entityType: "opportunity_mapping",
      entityId: String(opportunityId),
      action: "view_mapping_context",
      changesJson: {
        linkedClientId: opportunity.clientId ?? null,
        linkedProjectId: linkedProject?.id ?? null,
        existingEngineeringTicketCount: Number(existingEngineeringTicketCount?.count || 0),
      },
    });

    res.json({
      opportunity: {
        ...opportunity,
        dealName,
      },
      linkedClient: opportunity.clientId ? { id: opportunity.clientId, name: opportunity.clientName } : null,
      linkedProject: linkedProject || null,
      likelyClients,
      likelyProjects,
      existingEngineeringTicketCount: Number(existingEngineeringTicketCount?.count || 0),
    });
  } catch (err) {
    console.error("[Opportunities] Failed to fetch mapping context:", err);
    res.status(500).json({ error: "Failed to fetch mapping context" });
  }
});

router.post("/api/opportunities/:id/resolve-mapping", requireAuth, requirePermission("pd_tickets", "create"), async (req: Request, res: Response) => {
  try {
    const role = String((req.user as any)?.companyRole || (req.user as any)?.role || "");
    if (!canMutateOpportunityIntake(role)) {
      return res.status(403).json({ error: "Mapping authority is limited to Project Development role(s)." });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId)) return res.status(400).json({ error: "Invalid opportunity id" });
    const parsed = mappingResolveSchema.parse(req.body || {});
    const user = req.user as any;

    const [opportunity] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.source !== "pipedrive") {
      return res.status(400).json({ error: "Only pipedrive opportunities are supported in this flow." });
    }
    if (opportunity.deletedAt) return res.status(409).json({ error: "Archived opportunities cannot be mapped." });
    if (isOpportunityIntakeTerminal(opportunity)) {
      return res.status(409).json({ error: "Terminal opportunity states cannot be mapped for new engineering ticket creation." });
    }

    const [existingLinkedProject] = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName, clientId: projectInfo.clientId })
      .from(projectInfo)
      .where(and(eq(projectInfo.opportunityId, opportunityId), isNull(projectInfo.deletedAt)))
      .orderBy(desc(projectInfo.id));

    const duplicateWarnings: string[] = [];
    const plan = buildOpportunityMappingPlan({
      mode: parsed.mode,
      linkedProjectExists: Boolean(existingLinkedProject),
      existingClientId: parsed.existingClientId ?? null,
      existingProjectId: parsed.existingProjectId ?? null,
      newClientName: parsed.newClientName ?? null,
      newProjectName: parsed.newProjectName ?? null,
    });
    if (!plan.ok) {
      const err = plan.error || "Invalid mapping request";
      const status = err.includes("already exists") ? 409 : 400;
      if (existingLinkedProject) {
        duplicateWarnings.push(`Opportunity already linked to project ${existingLinkedProject.projectName} (#${existingLinkedProject.id}). First-ticket shell already exists.`);
      }
      return res.status(status).json({ error: err, warnings: duplicateWarnings, linkedProject: existingLinkedProject || null });
    }

    let resolvedClient: { id: number; name: string; clientId: string | null } | null = null;
    let resolvedProject: { id: number; projectName: string } | null = null;
    let createdClient = false;
    let createdProjectShell = false;

    if (parsed.mode === "existing_existing") {
      const [clientRow] = await db.select({ id: clients.id, name: clients.name, clientId: clients.clientId }).from(clients).where(eq(clients.id, parsed.existingClientId!));
      const [projectRow] = await db
        .select({ id: projectInfo.id, projectName: projectInfo.projectName, clientId: projectInfo.clientId })
        .from(projectInfo)
        .where(and(eq(projectInfo.id, parsed.existingProjectId!), isNull(projectInfo.deletedAt)));

      if (!clientRow || !projectRow) return res.status(404).json({ error: "Selected client or project was not found." });
      resolvedClient = clientRow;
      resolvedProject = { id: projectRow.id, projectName: projectRow.projectName };
    }

    if (parsed.mode === "existing_new") {
      const [clientRow] = await db.select({ id: clients.id, name: clients.name, clientId: clients.clientId }).from(clients).where(eq(clients.id, parsed.existingClientId!));
      if (!clientRow) return res.status(404).json({ error: "Selected client was not found." });
      resolvedClient = clientRow;
    }

    if (parsed.mode === "new_new") {
      const [duplicateClient] = await db.select({ id: clients.id, name: clients.name, clientId: clients.clientId }).from(clients).where(ilike(clients.name, parsed.newClientName!));
      if (duplicateClient) {
        duplicateWarnings.push(`Client name already exists: ${duplicateClient.name} (#${duplicateClient.id}).`);
        if (!parsed.confirmDuplicates) {
          return res.status(409).json({ error: "duplicate_client", warnings: duplicateWarnings, suggestedClient: duplicateClient });
        }
        resolvedClient = duplicateClient;
        logAuditFromReq(req, {
          entityType: "opportunity_mapping",
          entityId: String(opportunityId),
          action: "reuse_duplicate_client",
          changesJson: {
            selectedClientId: duplicateClient.id,
            selectedClientName: duplicateClient.name,
            reason: "duplicate_name_confirmed",
          },
        });
      } else {
        const created = await insertClientWithGeneratedId({
          name: parsed.newClientName!,
          createdBy: user?.id || null,
          updatedBy: user?.id || null,
        });
        resolvedClient = { id: created.id, name: created.name, clientId: created.clientId };
        createdClient = true;
        logAuditFromReq(req, {
          entityType: "client",
          entityId: String(created.id),
          action: "create_from_opportunity_mapping",
          changesJson: {
            opportunityId,
            mode: parsed.mode,
            clientName: created.name,
            generatedClientCode: created.clientId ?? null,
          },
        });
      }
    }

    if (!resolvedProject) {
      const newProjectName = String(parsed.newProjectName || "").trim();
      if (!newProjectName) {
        return res.status(400).json({ error: "newProjectName is required for project-shell creation." });
      }

      const [duplicateProject] = await db
        .select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo)
        .where(and(eq(projectInfo.projectName, newProjectName), isNull(projectInfo.deletedAt)));

      if (duplicateProject) {
        duplicateWarnings.push(`Project name already exists: ${duplicateProject.projectName} (#${duplicateProject.id}). Use existing project mapping.`);
        return res.status(409).json({ error: "duplicate_project", warnings: duplicateWarnings, suggestedProject: duplicateProject });
      }

      const shellProjectFields = {
        projectName: newProjectName,
        clientId: resolvedClient?.id ?? opportunity.clientId ?? null,
        opportunityId: opportunityId,
        projectCode: `SHELL-OPP-${opportunityId}`,
        phase: "P0_FIRST_ASSESSMENT",
        phaseUpdatedAt: new Date(),
        phaseUpdatedByUserId: user?.id || null,
        phaseNotes: `[SHELL] Created from opportunity #${opportunityId} before execution readiness.`,
        pd: "PROJECT_SHELL",
      };

      const [createdProject] = await db.insert(projectInfo).values(shellProjectFields).returning();
      await syncProjectSplitTablesAfterInsert(createdProject.id, shellProjectFields);
      await db.insert(projectPhaseHistory).values({
        projectId: createdProject.id,
        fromPhase: null,
        toPhase: "P0_FIRST_ASSESSMENT",
        changedByUserId: user?.id || null,
        reason: `Project shell created from opportunity #${opportunityId}`,
      });
      resolvedProject = { id: createdProject.id, projectName: createdProject.projectName };
      createdProjectShell = true;
      logAuditFromReq(req, {
        entityType: "project",
        entityId: String(createdProject.id),
        action: "create_shell_from_opportunity_mapping",
        changesJson: {
          opportunityId,
          clientId: resolvedClient?.id ?? opportunity.clientId ?? null,
          projectName: createdProject.projectName,
          phase: "P0_FIRST_ASSESSMENT",
        },
      });
    }

    // Ensure the opportunity points to the resolved client for continuity.
    if (resolvedClient?.id && opportunity.clientId !== resolvedClient.id) {
      await db
        .update(opportunities)
        .set({ clientId: resolvedClient.id, updatedAt: new Date() })
        .where(eq(opportunities.id, opportunityId));
      logAuditFromReq(req, {
        entityType: "opportunity",
        entityId: String(opportunityId),
        action: "link_client_from_mapping",
        changesJson: { previousClientId: opportunity.clientId ?? null, nextClientId: resolvedClient.id },
      });
    }

    logAuditFromReq(req, {
      entityType: "opportunity_mapping",
      entityId: String(opportunityId),
      action: "resolve_for_engineering_ticket",
      changesJson: {
        mode: parsed.mode,
        clientId: resolvedClient?.id ?? null,
        projectId: resolvedProject?.id ?? null,
        createdClient,
        createdProjectShell,
        projectShellStatus: createdProjectShell ? "SHELL_ONLY" : "EXISTING_PROJECT",
      },
    });

    res.json({
      opportunityId,
      mode: parsed.mode,
      client: resolvedClient,
      project: resolvedProject,
      createdClient,
      createdProjectShell,
      projectShellStatus: createdProjectShell ? "SHELL_ONLY" : "EXISTING_PROJECT",
      warnings: duplicateWarnings,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Opportunities] resolve mapping failed:", err);
    res.status(500).json({ error: "Failed to resolve mapping" });
  }
});

router.get("/api/opportunities", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    const stage = req.query.stage as string | undefined;
    const conditions = [isNull(opportunities.deletedAt)];
    if (clientId) conditions.push(eq(opportunities.clientId, clientId));
    if (stage) conditions.push(eq(opportunities.stage, stage));

    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));

    res.json(rows);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunities" });
  }
});

router.get("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, Number(req.params.id)));

    if (!row) return res.status(404).json({ error: "Opportunity not found" });
    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunity" });
  }
});

router.post("/api/opportunities", requireAuth, requirePermission("opportunities", "create"), async (req: Request, res: Response) => {
  try {
    const parsed = opportunityCreateSchema.parse(req.body);
    // Force `source` to 'internal' on the manual create path — the
    // Pipedrive sync engine is the only writer allowed to set 'pipedrive'.
    const [row] = await db
      .insert(opportunities)
      .values({ ...parsed, source: "internal" })
      .returning();

    logAuditFromReq(req, {
      entityType: "opportunity",
      entityId: String(row.id),
      action: "create",
      changesJson: {
        source: "internal",
        clientId: row.clientId ?? null,
        stage: row.stage,
        status: row.status,
        estimatedValue: row.estimatedValue ?? null,
      },
    });

    res.status(201).json(row);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Opportunities] Failed to create:", err);
    res.status(500).json({ error: "Failed to create opportunity" });
  }
});

router.patch("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "edit"), async (req: Request, res: Response) => {
  try {
    const parsed = opportunityCreateSchema.partial().parse(req.body);

    // Guard: if this opportunity is Pipedrive-sourced, the CRM-owned
    // fields will be overwritten by the next sync. We still allow the
    // update so the user can unblock themselves, but we warn on the
    // response so the UI can surface it. App-only fields (notes,
    // commercialRisks, fundingType) are always safe to edit.
    const [existing] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, Number(req.params.id)));
    if (!existing) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    // Never allow the PATCH path to mutate `source` or `pipedriveDealId`.
    // Both identify the row's origin and must only be written by the
    // sync engine.
    const { source: _source, ...safeFields } = parsed as typeof parsed & { source?: unknown };
    void _source;

    const [row] = await db
      .update(opportunities)
      .set({ ...safeFields, updatedAt: new Date() })
      .where(eq(opportunities.id, Number(req.params.id)))
      .returning();

    const crmOverwriteFields = ["stage", "status", "estimatedValue", "expectedCloseDate", "signedDate", "clientId"] as const;
    const touchesCrmField = existing.source === "pipedrive"
      && crmOverwriteFields.some(f => (safeFields as Record<string, unknown>)[f] !== undefined);

    // Only log the fields the user actually sent. `safeFields` already
    // excludes `source` and `pipedriveDealId` so the audit trail cannot
    // claim the user changed origin when they couldn't.
    const changedKeys = Object.keys(safeFields).filter(
      k => (safeFields as Record<string, unknown>)[k] !== undefined,
    );
    if (changedKeys.length > 0) {
      logAuditFromReq(req, {
        entityType: "opportunity",
        entityId: String(row.id),
        action: touchesCrmField ? "update_crm_field_on_synced_row" : "update",
        changesJson: {
          source: existing.source,
          changed: changedKeys,
          values: changedKeys.reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (safeFields as Record<string, unknown>)[k];
            return acc;
          }, {}),
        },
      });
    }

    res.json({
      ...row,
      _warning: touchesCrmField
        ? "This opportunity is synced from Pipedrive. The next sync run will overwrite stage, status, estimated value, expected close date, signed date, and clientId with the Pipedrive values. App-only fields (notes, commercial risks, funding type) will be preserved."
        : undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("[Opportunities] Failed to update:", err);
    res.status(500).json({ error: "Failed to update opportunity" });
  }
});

router.delete("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "delete"), async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .update(opportunities)
      .set({ deletedAt: new Date() })
      .where(eq(opportunities.id, Number(req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Opportunity not found" });

    logAuditFromReq(req, {
      entityType: "opportunity",
      entityId: String(row.id),
      action: "soft_delete",
      changesJson: { source: row.source, pipedriveDealId: row.pipedriveDealId ?? null },
    });

    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to delete:", err);
    res.status(500).json({ error: "Failed to delete opportunity" });
  }
});

export function registerOpportunitiesRoutes(app: Express) {
  app.use(router);
}
