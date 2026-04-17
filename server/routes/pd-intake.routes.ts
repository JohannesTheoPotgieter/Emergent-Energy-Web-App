/**
 * Unified Project Development intake endpoints.
 *
 * Combines Pipedrive opportunities and PD tickets into a single surface
 * for the merged Pipeline page. Read-only — all mutations (convert, spawn
 * tickets, edit tickets) continue to use the existing endpoints:
 *   POST /api/opportunities/:id/resolve-mapping
 *   POST /api/opportunities/:id/create-engineering-tickets
 *   POST /api/pd/tickets
 *   DELETE /api/pd/tickets/:id
 *
 * Endpoints:
 *   GET /api/pd/intake/rows   — all opportunities + all tickets, grouped
 *   GET /api/pd/intake/stats  — at-a-glance counts for the page header
 *
 * Permission gate: user must have EITHER opportunities:view OR pd_tickets:view.
 * Per-row `actions` field encodes what the calling user can do on each row
 * so the frontend doesn't need to re-derive capability from role strings.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { opportunitiesRepo } from "../repositories/opportunities-repository";
import { getConversionCta } from "@shared/pipedrive-stage-map";
import { canCreatePdTicket, canViewAllTickets, canViewOpportunityIntake } from "@shared/roles/pd-roles";
import { ApiError, serverError } from "../lib/api-error";

// ---- Row action types ----

type IntakeAction =
  | "spawn_first_assessment"
  | "spawn_cost_proposal"
  | "spawn_custom"
  | "edit_ticket"
  | "delete_ticket"
  | "view_ticket";

function oppActions(role: string, cta: ReturnType<typeof getConversionCta>, hasProject: boolean): IntakeAction[] {
  const actions: IntakeAction[] = [];
  if (!hasProject && cta === "first_assessment" && canCreatePdTicket(role)) {
    actions.push("spawn_first_assessment");
  }
  if (!hasProject && cta === "cost_proposal" && canCreatePdTicket(role)) {
    actions.push("spawn_cost_proposal");
    // Also offer first_assessment as a catch-up path if project not yet created
    actions.push("spawn_first_assessment");
  }
  if (hasProject && canCreatePdTicket(role)) {
    actions.push("spawn_custom");
  }
  return actions;
}

function ticketActions(role: string, ticketCreatedBy: number | null, userId: number | undefined): IntakeAction[] {
  const actions: IntakeAction[] = ["view_ticket"];
  const canEdit =
    canViewAllTickets(role) ||
    ticketCreatedBy === userId;
  if (canEdit) {
    actions.push("edit_ticket", "delete_ticket");
  }
  return actions;
}

// ---- Route handlers ----

async function handleGetRows(req: Request, res: Response) {
  const user = req.user;
  const role = String(user?.role || "");
  const userId = user?.id;

  const canSeeOpps = canViewOpportunityIntake(role);
  const canSeeTickets = true; // gated by requirePermission below; if reached, they can view

  // Fetch both sides in parallel
  const [opps, tickets] = await Promise.all([
    canSeeOpps ? opportunitiesRepo.getIntakeOpportunities() : Promise.resolve([]),
    opportunitiesRepo.getIntakeTickets(),
  ]);

  // Build a set of opportunity IDs that have at least one linked project
  // (needed for CTA logic — if project exists, "spawn" becomes "add ticket")
  const [linkedProjectCounts, linkedTicketCounts] = await Promise.all([
    opps.length > 0
      ? opportunitiesRepo.getLinkedProjectCounts(opps.map(o => o.id))
      : Promise.resolve([]),
    opps.length > 0
      ? opportunitiesRepo.getEngineeringTicketCounts(opps.map(o => o.id))
      : Promise.resolve([]),
  ]);

  const projectCountByOpp = new Map(linkedProjectCounts.map(r => [r.opportunityId!, r.count]));
  const ticketCountByOpp = new Map(linkedTicketCounts.map(r => [r.opportunityId!, r.count]));

  // Map opportunity rows → intake parent rows
  const oppRows = opps.map(opp => {
    const hasProject = (projectCountByOpp.get(opp.id) ?? 0) > 0;
    const cta = getConversionCta(opp.stage);
    return {
      kind: "opportunity" as const,
      id: `opp-${opp.id}`,
      sourceId: opp.id,
      groupKey: `opp-${opp.id}`,
      parentId: null,
      title: opp.notes || `Deal PD-${opp.pipedriveDealId ?? opp.id}`,
      pipedriveDealId: opp.pipedriveDealId,
      stage: opp.stage,
      status: opp.status,
      clientId: opp.clientId,
      clientName: opp.clientName,
      projectId: null,
      projectName: null,
      requestType: null,
      priority: null,
      dueDate: null,
      developerName: null,
      estimatedValue: opp.estimatedValue,
      updatedAt: opp.updatedAt?.toISOString() ?? null,
      createdAt: opp.createdAt?.toISOString() ?? null,
      hasLinkedProject: hasProject,
      childTicketCount: ticketCountByOpp.get(opp.id) ?? 0,
      subTasksTotal: null,
      subTasksDone: null,
      nextAction: null,
      conversionCta: cta,
      actions: oppActions(role, cta, hasProject),
    };
  });

  // Map ticket rows → intake child/root rows
  const ticketRows = tickets.map(tkt => ({
    kind: "ticket" as const,
    id: `tkt-${tkt.id}`,
    sourceId: tkt.id,
    groupKey: tkt.opportunityId ? `opp-${tkt.opportunityId}` : `tkt-${tkt.id}`,
    parentId: tkt.opportunityId ? `opp-${tkt.opportunityId}` : null,
    title: tkt.projectSiteName,
    pipedriveDealId: null,
    stage: tkt.status,
    status: tkt.status,
    clientId: tkt.clientId,
    clientName: tkt.clientName,
    projectId: tkt.projectId,
    projectName: tkt.projectName,
    requestType: tkt.requestType,
    priority: tkt.priority,
    dueDate: tkt.dueDate,
    developerName: tkt.developerName,
    estimatedValue: null,
    updatedAt: tkt.updatedAt?.toISOString() ?? null,
    createdAt: tkt.createdAt?.toISOString() ?? null,
    hasLinkedProject: !!tkt.projectId,
    childTicketCount: null,
    subTasksTotal: tkt.subTasksTotal,
    subTasksDone: tkt.subTasksDone,
    nextAction: tkt.nextAction ?? null,
    conversionCta: null,
    actions: ticketActions(role, null, userId),
  }));

  res.json({
    opportunities: oppRows,
    tickets: ticketRows,
  });
}

async function handleGetStats(req: Request, res: Response) {
  const stats = await opportunitiesRepo.getIntakeStats();
  res.json(stats);
}

// ---- Registration ----

export function registerPdIntakeRoutes(app: Express) {
  // Require auth + at least pd_tickets:view; canSeeOpps is derived inside handler
  app.get(
    "/api/pd/intake/rows",
    requireAuth,
    requirePermission("pd_tickets", "view"),
    async (req: Request, res: Response) => {
      try {
        await handleGetRows(req, res);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[pd-intake] rows error:", err);
        throw serverError("Failed to load intake rows");
      }
    },
  );

  app.get(
    "/api/pd/intake/stats",
    requireAuth,
    requirePermission("pd_tickets", "view"),
    async (req: Request, res: Response) => {
      try {
        await handleGetStats(req, res);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("[pd-intake] stats error:", err);
        throw serverError("Failed to load intake stats");
      }
    },
  );
}
