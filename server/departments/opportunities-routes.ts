/**
 * B3: Opportunities CRUD routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { db } from "../db";
import { z } from "zod";
import { logAuditFromReq } from "../audit-logger";
import { canCreatePdTicket, canViewOpportunityIntake } from "@shared/roles/pd-roles";
import { isActivePdWorkingOpportunity, isOpportunityIntakeTerminal } from "../lib/opportunity-working-filter";
import { insertClientWithGeneratedId } from "../lib/client-id-generator";
import { syncProjectSplitTablesAfterInsert } from "../lib/project-info-sync";
import { buildOpportunityMappingPlan } from "../lib/opportunity-mapping-plan";
import { buildCustomComments, buildSamePhaseDuplicateWarning, buildTemplateTicketDrafts } from "../lib/opportunity-engineering-ticket-flow";
import { opportunitiesRepo } from "../repositories/opportunities-repository";

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
// Decimal columns in Drizzle serialize as `string`; the UI may submit numbers
// for convenience. Coerce once at the boundary so the repository receives the
// exact type Drizzle's $inferInsert expects (`string | null | undefined`).
const decimalInput = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined ? undefined : String(v)));

const opportunityCreateSchema = z.object({
  clientId: z.number().int().optional(),
  siteId: z.number().int().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
  contractType: z.string().optional(),
  estimatedValue: decimalInput,
  estimatedKwp: decimalInput,
  estimatedKwh: decimalInput,
  expectedCloseDate: z.string().optional(),
  signedDate: z.string().optional(),
  notes: z.string().optional(),
  fundingType: z.string().optional(),
  commercialRisks: z.string().optional(),
  source: z.literal("internal").optional(),
});

const router = Router();

/** Extract role from typed req.user (Express augmentation defines .role). */
function getUserRole(req: Request): string {
  return req.user?.role ?? "";
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
  newClientName: z.string().trim().max(200).optional(),
  newProjectName: z.string().trim().max(200).optional(),
  confirmDuplicates: z.boolean().optional().default(false),
});

/**
 * PD working-list read model.
 * Designed for the Opportunities working view and future "Create Engineering Ticket" action.
 */
router.get("/api/opportunities/working", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    if (!canViewOpportunityIntake(getUserRole(req))) {
      return res.status(403).json({ error: "Opportunities intake view is limited to Project Development and admin oversight roles." });
    }

    const rows = await opportunitiesRepo.getWorkingListRows();
    const opportunityIds = rows.map(r => r.id);
    if (opportunityIds.length === 0) return res.json([]);

    const [linkedProjectCounts, engineeringTicketCounts] = await Promise.all([
      opportunitiesRepo.getLinkedProjectCounts(opportunityIds),
      opportunitiesRepo.getEngineeringTicketCounts(opportunityIds),
    ]);

    const projectCountByOpportunity = new Map<number, number>();
    for (const r of linkedProjectCounts) {
      if (r.opportunityId != null) projectCountByOpportunity.set(r.opportunityId, r.count);
    }
    const engineeringTicketCountByOpportunity = new Map<number, number>();
    for (const r of engineeringTicketCounts) {
      if (r.opportunityId != null) engineeringTicketCountByOpportunity.set(r.opportunityId, r.count);
    }

    const workingRows = rows
      .map(r => {
        const linkedProjectCount = projectCountByOpportunity.get(r.id) || 0;
        const hasLinkedProject = linkedProjectCount > 0;
        // Prefer the canonical `opportunities.deal_name` column populated
        // by Pipedrive sync (M001-M003); fall back to the legacy notes
        // parsing only for rows that pre-date the migration backfill.
        const note = (r.notes || "").trim();
        const dealName =
          (r.dealName && r.dealName.trim()) ||
          (note.toLowerCase().startsWith("pipedrive:")
            ? note.replace(/^pipedrive:\s*/i, "").trim()
            : (note || `Deal #${r.pipedriveDealId || r.id}`));

        return {
          id: r.id,
          dealName,
          pipedriveDealId: r.pipedriveDealId,
          orgClientName: r.clientName || null,
          // Prefer the joined user-name (live FK), fall back to the
          // snapshot stored at sync time when the user link is missing.
          dealOwner: r.dealOwnerUserName || r.dealOwnerNameSnapshot || null,
          stage: r.stage || null,
          status: r.status || null,
          siteLocation: r.siteName || r.siteAddress || null,
          hasLinkedClient: Boolean(r.clientId),
          hasLinkedProject,
          linkedProjectCount,
          existingEngineeringTicketCount: engineeringTicketCountByOpportunity.get(r.id) || 0,
          lastUpdated: r.updatedAt || null,
          signedDate: r.signedDate || null,
          expectedCloseDate: r.expectedCloseDate || null,
        };
      })
      .filter(r => isActivePdWorkingOpportunity({
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


/**
 * Phase templates are global — the endpoint does not use an opportunity ID.
 * Legacy URL with :id is kept as an alias for backwards compatibility.
 */
router.get("/api/opportunities/engineering-phase-templates", requireAuth, requirePermission("pd_tickets", "create"), async (req: Request, res: Response) => {
  try {
    if (!canViewOpportunityIntake(getUserRole(req))) {
      return res.status(403).json({ error: "Template inspection is limited to Project Development and admin oversight roles." });
    }
    const templates = await opportunitiesRepo.getActivePhaseTemplates();
    res.json(templates);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch engineering phase templates:", err);
    res.status(500).json({ error: "Failed to fetch engineering phase templates" });
  }
});
// Backwards-compat alias for old client code that includes :id
router.get("/api/opportunities/:id/engineering-phase-templates", requireAuth, requirePermission("pd_tickets", "create"), async (req: Request, res: Response) => {
  try {
    if (!canViewOpportunityIntake(getUserRole(req))) {
      return res.status(403).json({ error: "Template inspection is limited to Project Development and admin oversight roles." });
    }
    const templates = await opportunitiesRepo.getActivePhaseTemplates();
    res.json(templates);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch engineering phase templates:", err);
    res.status(500).json({ error: "Failed to fetch engineering phase templates" });
  }
});

router.post("/api/opportunities/:id/create-engineering-tickets", requireAuth, requirePermission("pd_tickets", "create"), validateBody(engineeringTicketCreateSchema), async (req: Request, res: Response) => {
  try {
    if (!canCreatePdTicket(getUserRole(req))) {
      return res.status(403).json({ error: "Engineering ticket creation authority is limited to Project Development role(s)." });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId)) return res.status(400).json({ error: "Invalid opportunity id" });
    const parsed = req.body as z.infer<typeof engineeringTicketCreateSchema>;
    const userId = req.user?.id ?? null;

    // --- Pre-flight checks (reads before transaction) ---
    const opportunity = await opportunitiesRepo.getOpportunityCore(opportunityId);
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.source !== "pipedrive") {
      return res.status(400).json({ error: "Only pipedrive opportunities are supported in this flow." });
    }
    if (opportunity.deletedAt) {
      return res.status(409).json({ error: "This opportunity has been archived and cannot create tickets." });
    }
    if (isOpportunityIntakeTerminal(opportunity)) {
      return res.status(409).json({ error: "Terminal opportunity states (lost/won/signed/closed) cannot create new engineering tickets." });
    }

    const clientRow = await opportunitiesRepo.getClientById(parsed.clientId);
    if (!clientRow) return res.status(404).json({ error: "Client not found" });

    const projectRow = await opportunitiesRepo.getProjectById(parsed.projectId);
    if (!projectRow) return res.status(404).json({ error: "Project not found" });

    // --- Build ticket values before entering the transaction ---
    interface CreatedTicket { id: number; [key: string]: unknown }
    const warnings: string[] = [];
    let ticketValues: Array<Record<string, unknown>> = [];

    if (parsed.mode === "custom") {
      if (!parsed.customTicket) return res.status(400).json({ error: "customTicket payload is required for custom mode" });
      const count = await opportunitiesRepo.countSamePhaseTickets(opportunityId, parsed.projectId, parsed.customTicket.phase);
      warnings.push(...buildSamePhaseDuplicateWarning(parsed.customTicket.phase, count));
      ticketValues = [{
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
        projectDeveloperUserId: userId,
        createdBy: userId,
      }];
    }

    if (parsed.mode === "phase_template") {
      if (!parsed.phaseTemplateId) return res.status(400).json({ error: "phaseTemplateId is required for phase_template mode" });
      const template = await opportunitiesRepo.getPhaseTemplateById(parsed.phaseTemplateId);
      if (!template) return res.status(404).json({ error: "Active phase template not found" });

      const count = await opportunitiesRepo.countSamePhaseTickets(opportunityId, parsed.projectId, template.phase);
      warnings.push(...buildSamePhaseDuplicateWarning(template.phase, count));

      const items = await opportunitiesRepo.getTemplateItems(template.id);
      if (items.length === 0) return res.status(400).json({ error: "Selected template has no active items" });

      const baseDueDate = parsed.templateBaseDueDate || new Date().toISOString().slice(0, 10);
      const drafts = buildTemplateTicketDrafts({
        templatePhase: template.phase,
        templateName: template.name,
        templateVersion: template.version,
        baseDueDate,
        items,
      });

      ticketValues = drafts.map(draft => ({
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
        projectDeveloperUserId: userId,
        createdBy: userId,
        _templateItemId: draft.templateItemId,
        _templateId: template.id,
        _templateName: template.name,
        _templateVersion: template.version,
        _templatePhase: template.phase,
      }));
    }

    // --- Insert all tickets inside a single transaction ---
    const createdTickets = await db.transaction(async (tx: typeof db) => {
      const results: CreatedTicket[] = [];
      for (const values of ticketValues) {
        const { _templateItemId, _templateId, _templateName, _templateVersion, _templatePhase, ...insertValues } = values;
        const ticket = await opportunitiesRepo.insertPdTicket(tx, insertValues);
        results.push(ticket);
      }
      return results;
    });

    // --- Audit logging (outside transaction — fire-and-forget) ---
    for (let i = 0; i < createdTickets.length; i++) {
      const ticket = createdTickets[i];
      const values = ticketValues[i];
      const isTemplate = parsed.mode === "phase_template";
      logAuditFromReq(req, {
        entityType: "pd_ticket",
        entityId: String(ticket.id),
        action: isTemplate ? "create_from_opportunity_phase_template" : "create_from_opportunity_custom",
        changesJson: {
          opportunityId,
          clientId: parsed.clientId,
          projectId: parsed.projectId,
          phase: isTemplate ? values._templatePhase : parsed.customTicket?.phase,
          ...(isTemplate ? { templateId: values._templateId, templateName: values._templateName, templateVersion: values._templateVersion, templateItemId: values._templateItemId } : {}),
          duplicateWarning: warnings.length > 0,
          traceability: "opportunity+client+project",
        },
      });
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
    console.error("[Opportunities] create engineering tickets failed:", err);
    res.status(500).json({ error: "Failed to create engineering tickets" });
  }
});

router.get("/api/opportunities/:id/mapping-context", requireAuth, requirePermission("pd_tickets", "create"), async (req: Request, res: Response) => {
  try {
    if (!canViewOpportunityIntake(getUserRole(req))) {
      return res.status(403).json({ error: "Mapping inspection is limited to Project Development and admin oversight roles." });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId)) return res.status(400).json({ error: "Invalid opportunity id" });

    const opportunity = await opportunitiesRepo.getOpportunityWithClient(opportunityId);
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.source !== "pipedrive") {
      return res.status(400).json({ error: "Only pipedrive opportunities are supported in this flow." });
    }
    if (isOpportunityIntakeTerminal(opportunity)) {
      return res.status(409).json({ error: "Terminal opportunity states cannot be mapped for new engineering ticket creation." });
    }

    const linkedProject = await opportunitiesRepo.getLinkedProject(opportunityId);
    const dealName = ((opportunity.notes || "").replace(/^pipedrive:\s*/i, "").trim() || `Deal ${opportunityId}`).slice(0, 120);
    const searchTerm = (opportunity.clientName || dealName).split(" ")[0] || "";

    const [likelyClients, likelyProjects, ticketCount] = await Promise.all([
      opportunitiesRepo.findLikelyClients(searchTerm),
      opportunitiesRepo.findLikelyProjects(dealName.split(" ")[0] || ""),
      opportunitiesRepo.countEngineeringTickets(opportunityId),
    ]);

    // No audit event on read — audit is reserved for mutations.
    res.json({
      opportunity: { ...opportunity, dealName },
      linkedClient: opportunity.clientId ? { id: opportunity.clientId, name: opportunity.clientName } : null,
      linkedProject: linkedProject || null,
      likelyClients,
      likelyProjects,
      existingEngineeringTicketCount: ticketCount,
    });
  } catch (err) {
    console.error("[Opportunities] Failed to fetch mapping context:", err);
    res.status(500).json({ error: "Failed to fetch mapping context" });
  }
});

router.post("/api/opportunities/:id/resolve-mapping", requireAuth, requirePermission("pd_tickets", "create"), validateBody(mappingResolveSchema), async (req: Request, res: Response) => {
  try {
    if (!canCreatePdTicket(getUserRole(req))) {
      return res.status(403).json({ error: "Mapping authority is limited to Project Development role(s)." });
    }

    const opportunityId = Number(req.params.id);
    if (!Number.isFinite(opportunityId)) return res.status(400).json({ error: "Invalid opportunity id" });
    const parsed = req.body as z.infer<typeof mappingResolveSchema>;
    const userId = req.user?.id ?? null;

    const opportunity = await opportunitiesRepo.getOpportunityById(opportunityId);
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.source !== "pipedrive") {
      return res.status(400).json({ error: "Only pipedrive opportunities are supported in this flow." });
    }
    if (opportunity.deletedAt) return res.status(409).json({ error: "Archived opportunities cannot be mapped." });
    if (isOpportunityIntakeTerminal(opportunity)) {
      return res.status(409).json({ error: "Terminal opportunity states cannot be mapped for new engineering ticket creation." });
    }

    const existingLinkedProject = await opportunitiesRepo.getLinkedProject(opportunityId);
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
      const planErr = plan.error || "Invalid mapping request";
      const status = planErr.includes("already exists") ? 409 : 400;
      if (existingLinkedProject) {
        duplicateWarnings.push(`Opportunity already linked to project ${existingLinkedProject.projectName} (#${existingLinkedProject.id}). First-ticket shell already exists.`);
      }
      return res.status(status).json({ error: planErr, warnings: duplicateWarnings, linkedProject: existingLinkedProject || null });
    }

    let resolvedClient: { id: number; name: string; clientId: string | null } | null = null;
    let resolvedProject: { id: number; projectName: string } | null = null;
    let createdClient = false;
    let createdProjectShell = false;

    // --- Resolve client ---
    if (parsed.mode === "existing_existing" || parsed.mode === "existing_new") {
      const clientRow = await opportunitiesRepo.getClientById(parsed.existingClientId!);
      if (!clientRow) return res.status(404).json({ error: "Selected client was not found." });
      resolvedClient = clientRow;
    }
    if (parsed.mode === "existing_existing") {
      const projectRow = await opportunitiesRepo.getProjectById(parsed.existingProjectId!);
      if (!projectRow) return res.status(404).json({ error: "Selected project was not found." });
      resolvedProject = { id: projectRow.id, projectName: projectRow.projectName };
    }
    if (parsed.mode === "new_new") {
      const duplicateClient = await opportunitiesRepo.findClientByNameExact(parsed.newClientName!);
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
          changesJson: { selectedClientId: duplicateClient.id, selectedClientName: duplicateClient.name, reason: "duplicate_name_confirmed" },
        });
      } else {
        const created = await insertClientWithGeneratedId({
          name: parsed.newClientName!,
          createdBy: userId,
          updatedBy: userId,
        });
        resolvedClient = { id: created.id, name: created.name, clientId: created.clientId };
        createdClient = true;
        logAuditFromReq(req, {
          entityType: "client",
          entityId: String(created.id),
          action: "create_from_opportunity_mapping",
          changesJson: { opportunityId, mode: parsed.mode, clientName: created.name, generatedClientCode: created.clientId ?? null },
        });
      }
    }

    // --- Create project shell inside a transaction if needed ---
    if (!resolvedProject) {
      const newProjectName = String(parsed.newProjectName || "").trim();
      if (!newProjectName) {
        return res.status(400).json({ error: "newProjectName is required for project-shell creation." });
      }
      const duplicateProject = await opportunitiesRepo.findProjectByNameExact(newProjectName);
      if (duplicateProject) {
        duplicateWarnings.push(`Project name already exists: ${duplicateProject.projectName} (#${duplicateProject.id}). Use existing project mapping.`);
        return res.status(409).json({ error: "duplicate_project", warnings: duplicateWarnings, suggestedProject: duplicateProject });
      }

      const shellProjectFields = {
        projectName: newProjectName,
        clientId: resolvedClient?.id ?? opportunity.clientId ?? null,
        opportunityId,
        projectCode: `SHELL-OPP-${opportunityId}`,
        phase: "P0_FIRST_ASSESSMENT",
        phaseUpdatedAt: new Date(),
        phaseUpdatedByUserId: userId,
        phaseNotes: `[SHELL] Created from opportunity #${opportunityId} before execution readiness.`,
        pd: "PROJECT_SHELL",
      };

      const createdProject = await db.transaction(async (tx: typeof db) => {
        const proj = await opportunitiesRepo.insertProjectShell(tx, shellProjectFields);
        await syncProjectSplitTablesAfterInsert(proj.id, shellProjectFields, tx);
        await opportunitiesRepo.insertPhaseHistory(tx, {
          projectId: proj.id,
          fromPhase: null,
          toPhase: "P0_FIRST_ASSESSMENT",
          changedByUserId: userId,
          reason: `Project shell created from opportunity #${opportunityId}`,
        });
        if (resolvedClient?.id && opportunity.clientId !== resolvedClient.id) {
          await opportunitiesRepo.updateOpportunityClient(tx, opportunityId, resolvedClient.id);
        }
        return proj;
      });

      resolvedProject = { id: createdProject.id, projectName: createdProject.projectName };
      createdProjectShell = true;

      logAuditFromReq(req, {
        entityType: "project",
        entityId: String(createdProject.id),
        action: "create_shell_from_opportunity_mapping",
        changesJson: { opportunityId, clientId: resolvedClient?.id ?? opportunity.clientId ?? null, projectName: createdProject.projectName, phase: "P0_FIRST_ASSESSMENT" },
      });
    } else if (resolvedClient?.id && opportunity.clientId !== resolvedClient.id) {
      // No shell needed but client link needs updating
      await opportunitiesRepo.updateOpportunityClient(db, opportunityId, resolvedClient.id);
    }

    if (resolvedClient?.id && opportunity.clientId !== resolvedClient.id) {
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
    console.error("[Opportunities] resolve mapping failed:", err);
    res.status(500).json({ error: "Failed to resolve mapping" });
  }
});

router.get("/api/opportunities", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
    const stage = req.query.stage as string | undefined;
    const rows = await opportunitiesRepo.listOpportunities({ clientId, stage });
    res.json(rows);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunities" });
  }
});

router.get("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "view"), async (req: Request, res: Response) => {
  try {
    const row = await opportunitiesRepo.getOpportunityById(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Opportunity not found" });
    res.json(row);
  } catch (err) {
    console.error("[Opportunities] Failed to fetch:", err);
    res.status(500).json({ error: "Failed to fetch opportunity" });
  }
});

/**
 * Unified merged-Opportunity read used by the new drawer (2026-04-20).
 * Returns CRM truth + lazy-created PD shadow + spawned tasks in one
 * payload. The shadow row is materialised on first open so legacy
 * Pipedrive-imported deals do not need a back-fill migration.
 */
router.get(
  "/api/opportunities/:id/workflow",
  requireAuth,
  requirePermission("opportunities", "view"),
  async (req: Request, res: Response) => {
    try {
      const merged = await opportunitiesRepo.getOpportunityWithWorkflow(
        Number(req.params.id),
        req.user?.id ?? null,
      );
      if (!merged) return res.status(404).json({ error: "Opportunity not found" });
      res.json(merged);
    } catch (err) {
      console.error("[Opportunities] Failed workflow fetch:", err);
      res.status(500).json({ error: "Failed to load opportunity workflow" });
    }
  },
);

/**
 * PD-side update. Whitelist-only — CRM-owned columns (stage, status,
 * estimated value, expected close date, signed date, clientId) are not
 * accepted here; the existing PATCH /api/opportunities/:id is the only
 * surface that mutates the CRM block, and the Pipedrive sync still
 * overwrites that block on every run for sourced deals.
 */
const pdShadowPatchSchema = z.object({
  requestType: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  status: z.enum(["Draft", "In Progress", "On Hold", "Completed", "Cancelled"]).optional(),
  dueDate: z.string().nullable().optional(),
  projectDeveloperUserId: z.number().int().nullable().optional(),
  designerUserId: z.number().int().nullable().optional(),
  billsOrTariffData: z.boolean().optional(),
  meteringDataAvailable: z.boolean().optional(),
  siteInspectionForm: z.boolean().optional(),
  siteInspectionLink: z.string().nullable().optional(),
  batteriesNeeded: z.boolean().optional(),
  batterySize: z.union([z.string(), z.number()]).nullable().optional()
    .transform(v => v == null ? null : String(v)),
  dieselGenIntegration: z.boolean().optional(),
  roofReplacementNeeded: z.boolean().optional(),
  hseDiscussed: z.boolean().optional(),
  comments: z.string().nullable().optional(),
  estimatedCost: z.union([z.string(), z.number()]).nullable().optional()
    .transform(v => v == null ? null : String(v)),
  estimatedMargin: z.union([z.string(), z.number()]).nullable().optional()
    .transform(v => v == null ? null : String(v)),
  estimatedMarginPercent: z.union([z.string(), z.number()]).nullable().optional()
    .transform(v => v == null ? null : String(v)),
  financialNotes: z.string().nullable().optional(),
}).strict();

router.patch(
  "/api/opportunities/:id/pd",
  requireAuth,
  requirePermission("opportunities", "edit"),
  async (req: Request, res: Response) => {
    if (!canCreatePdTicket(getUserRole(req))) {
      return res.status(403).json({ error: "PD-workflow edits require a PD-approved role." });
    }
    const parsed = pdShadowPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed (PD endpoint accepts PD-workflow fields only — CRM fields are owned by Pipedrive)",
        details: parsed.error.flatten(),
      });
    }
    try {
      const updated = await opportunitiesRepo.updatePdShadow(Number(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ error: "PD shadow not found — open the opportunity first to materialise it" });
      logAuditFromReq(req, {
        entityType: "opportunity_pd_shadow",
        entityId: String(updated.id),
        action: "update",
        changesJson: { opportunityId: Number(req.params.id), changed: Object.keys(parsed.data) },
      });
      res.json(updated);
    } catch (err) {
      console.error("[Opportunities] Failed PD update:", err);
      res.status(500).json({ error: "Failed to update PD workflow" });
    }
  },
);

/** Spawn engineering tasks from the request-type template against the PD shadow. */
router.post(
  "/api/opportunities/:id/spawn-tasks",
  requireAuth,
  requirePermission("opportunities", "edit"),
  async (req: Request, res: Response) => {
    if (!canCreatePdTicket(getUserRole(req))) {
      return res.status(403).json({ error: "Spawning engineering tasks requires a PD-approved role." });
    }
    try {
      const merged = await opportunitiesRepo.getOpportunityWithWorkflow(
        Number(req.params.id),
        req.user?.id ?? null,
      );
      if (!merged) return res.status(404).json({ error: "Opportunity not found" });
      if (!merged.pd.projectId) {
        return res.status(409).json({ error: "Convert this opportunity to a project first — tasks must attach to a project." });
      }
      if (merged.pd.tasksSpawnedAt) {
        return res.status(409).json({ error: "Tasks already spawned for this opportunity." });
      }
      const { spawnTasksForTicket } = await import("../pd-routes");
      const spawned = await spawnTasksForTicket(
        merged.pd,
        req.user,
        Array.isArray(req.body?.selectedTasks) ? req.body.selectedTasks : undefined,
        Array.isArray(req.body?.customTasks) ? req.body.customTasks : undefined,
      );
      res.json({ spawned: spawned.length, tasks: spawned });
    } catch (err) {
      console.error("[Opportunities] Failed task spawn:", err);
      res.status(500).json({ error: "Failed to spawn tasks" });
    }
  },
);

/**
 * Convert-to-Project wizard target. Creates a `project_info` row at
 * `S01_FIRST_ASSESSMENT`, links it back to the opportunity, links the
 * PD shadow to the new project, marks the shadow Completed, and flips
 * the opportunity status to 'won' if not already terminal.
 */
const convertSchema = z.object({
  projectName: z.string().min(1),
  pmUserId: z.number().int().nullable().optional(),
  clientId: z.number().int().nullable().optional(),
  siteId: z.number().int().nullable().optional(),
  sizeKwp: z.union([z.string(), z.number()]).nullable().optional()
    .transform(v => v == null ? null : String(v)),
}).strict();

router.post(
  "/api/opportunities/:id/convert-to-project",
  requireAuth,
  requirePermission("opportunities", "edit"),
  async (req: Request, res: Response) => {
    if (!canCreatePdTicket(getUserRole(req))) {
      return res.status(403).json({ error: "Convert-to-project requires a PD-approved role." });
    }
    const parsed = convertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const opportunityId = Number(req.params.id);
    try {
      const opp = await opportunitiesRepo.getOpportunityById(opportunityId);
      if (!opp) return res.status(404).json({ error: "Opportunity not found" });

      const { projectInfo, pdTickets, opportunities: oppTable } = await import("@shared/schema/projects");
      const { eq, desc } = await import("drizzle-orm");

      // Idempotency: if this opportunity is already linked to a project,
      // return that project instead of creating a duplicate. Prevents
      // double-clicks / retries from spawning multiple shells.
      const [existing] = await db
        .select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo)
        .where(eq(projectInfo.opportunityId, opportunityId))
        .limit(1);
      if (existing) {
        return res.status(200).json({ project: existing, alreadyExisted: true });
      }

      // The execution-state fields (`phase`, `ragStatus`) live on the
      // split tables — they are NOT columns on `project_info` post-canonical-phase
      // refactor. We mirror the `/resolve-mapping` shell-creation flow:
      // insert project_info, then sync split tables. Architect-flagged 2026-04-20.
      const projectShellFields = {
        projectName: parsed.data.projectName,
        clientId: parsed.data.clientId ?? opp.clientId ?? null,
        pmUserId: parsed.data.pmUserId ?? null,
        opportunityId,
        projectCode: `OPP-${opportunityId}`,
        inDlp: false,
        projectStatus: "active" as const,
        // execution-state extras consumed by syncProjectSplitTablesAfterInsert:
        phase: "S01_FIRST_ASSESSMENT",
        ragStatus: "green",
      };

      const result = await db.transaction(async (tx: typeof db) => {
        const [project] = await tx
          .insert(projectInfo)
          .values(projectShellFields as typeof projectInfo.$inferInsert)
          .returning();

        await syncProjectSplitTablesAfterInsert(project.id, projectShellFields, tx);

        const [shadow] = await tx
          .select()
          .from(pdTickets)
          .where(eq(pdTickets.opportunityId, opportunityId))
          .limit(1);
        if (shadow) {
          await tx
            .update(pdTickets)
            .set({
              projectId: project.id,
              status: "Completed",
              sizeKwp: parsed.data.sizeKwp ?? shadow.sizeKwp,
              updatedAt: new Date(),
            })
            .where(eq(pdTickets.id, shadow.id));
        }

        if (opp.status !== "won" && opp.status !== "lost") {
          await tx
            .update(oppTable)
            .set({ status: "won", updatedAt: new Date() })
            .where(eq(oppTable.id, opportunityId));
        }

        return project;
      });

      logAuditFromReq(req, {
        entityType: "opportunity",
        entityId: String(opportunityId),
        action: "convert_to_project",
        changesJson: { newProjectId: result.id, projectName: result.projectName },
      });

      res.status(201).json({ project: result });
    } catch (err) {
      console.error("[Opportunities] Failed convert-to-project:", err);
      res.status(500).json({ error: "Failed to convert opportunity to project" });
    }
  },
);

// Numeric fields on `opportunities` are stored as Drizzle `numeric` columns
// which serialize as strings. The Zod schema accepts either string or number
// for ergonomic payloads — coerce here so the repository receives the
// string-or-null shape its insert/update types require.
function normalizeOpportunityNumericFields<T extends {
  estimatedValue?: string | number;
  estimatedKwp?: string | number;
  estimatedKwh?: string | number;
}>(
  input: T,
): Omit<T, "estimatedValue" | "estimatedKwp" | "estimatedKwh"> & {
  estimatedValue?: string;
  estimatedKwp?: string;
  estimatedKwh?: string;
} {
  const out: Record<string, unknown> = { ...input };
  for (const key of ["estimatedValue", "estimatedKwp", "estimatedKwh"] as const) {
    const v = out[key];
    if (typeof v === "number") out[key] = String(v);
  }
  return out as Omit<T, "estimatedValue" | "estimatedKwp" | "estimatedKwh"> & {
    estimatedValue?: string;
    estimatedKwp?: string;
    estimatedKwh?: string;
  };
}

router.post("/api/opportunities", requireAuth, requirePermission("opportunities", "create"), validateBody(opportunityCreateSchema), async (req: Request, res: Response) => {
  try {
    const parsed = req.body as z.infer<typeof opportunityCreateSchema>;
    // Force `source` to 'internal' on the manual create path — the
    // Pipedrive sync engine is the only writer allowed to set 'pipedrive'.
    const row = await opportunitiesRepo.createOpportunity({
      ...normalizeOpportunityNumericFields(parsed),
      source: "internal",
    });

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
    console.error("[Opportunities] Failed to create:", err);
    res.status(500).json({ error: "Failed to create opportunity" });
  }
});

router.patch("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "edit"), async (req: Request, res: Response) => {
  try {
    const parsed = opportunityCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const existing = await opportunitiesRepo.getOpportunityById(Number(req.params.id));
    if (!existing) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    // Never allow the PATCH path to mutate `source` or `pipedriveDealId`.
    const { source: _source, ...safeFields } = parsed.data as typeof parsed.data & { source?: unknown };
    void _source;

    const row = await opportunitiesRepo.updateOpportunity(
      Number(req.params.id),
      normalizeOpportunityNumericFields(safeFields),
    );
    if (!row) return res.status(404).json({ error: "Opportunity not found" });

    const crmOverwriteFields = ["stage", "status", "estimatedValue", "expectedCloseDate", "signedDate", "clientId"] as const;
    const touchesCrmField = existing.source === "pipedrive"
      && crmOverwriteFields.some(f => (safeFields as Record<string, unknown>)[f] !== undefined);

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
    console.error("[Opportunities] Failed to update:", err);
    res.status(500).json({ error: "Failed to update opportunity" });
  }
});

router.delete("/api/opportunities/:id", requireAuth, requirePermission("opportunities", "delete"), async (req: Request, res: Response) => {
  try {
    const row = await opportunitiesRepo.softDeleteOpportunity(Number(req.params.id));
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
