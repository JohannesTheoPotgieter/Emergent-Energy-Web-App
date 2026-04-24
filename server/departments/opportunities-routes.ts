/**
 * B3: Opportunities CRUD routes
 */
import { Router, type Express, type Request, type Response } from "express";
import { sql, eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "./shared-middleware";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { db } from "../db";
import { z } from "zod";
import { logAuditFromReq } from "../audit-logger";
import { canCreatePdTicket, canViewOpportunityIntake } from "@shared/roles/pd-roles";
import { isActivePdWorkingOpportunity, isOpportunityIntakeTerminal } from "../lib/opportunity-working-filter";
import { canViewAllTickets } from "@shared/roles/pd-roles";
import { PHASES, PHASE_BY_CODE } from "@shared/phases";
import { pdStageToLifecycle } from "@shared/lib/pd-stage-lifecycle";
import { insertClientWithGeneratedId } from "../lib/client-id-generator";
import { syncProjectSplitTablesAfterInsert } from "../lib/project-info-sync";
import { buildOpportunityMappingPlan } from "../lib/opportunity-mapping-plan";
import { buildCustomComments, buildSamePhaseDuplicateWarning, buildTemplateTicketDrafts } from "../lib/opportunity-engineering-ticket-flow";
import { opportunitiesRepo } from "../repositories/opportunities-repository";
import { ENGINEERING_TICKET_STATUSES } from "@shared/engineering-ticket-status";

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
    title: z.string().trim().min(1, "Title is required"),
    phase: z.string().trim().min(1, "Phase is required"),
    descriptionScope: z.string().trim().min(1, "Description / scope is required"),
    dueDate: z.string().trim().min(1, "Due date is required"),
    priority: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium"),
    requiredOutput: z.string().trim().min(1, "Required output is required"),
    // Optional operational fields — let the manual ticket carry the same
    // metadata the full PD ticket would have. Pre-filled by the UI from
    // the opportunity row when available.
    fundingType: z.string().trim().optional(),
    sizeKwp: z.union([z.string(), z.number()]).optional()
      .transform((v) => (v === undefined || v === null || v === "" ? undefined : String(v))),
    province: z.string().trim().optional(),
    gpsCoordinates: z.string().trim().optional(),
    batteriesNeeded: z.boolean().optional(),
    batterySize: z.union([z.string(), z.number()]).optional()
      .transform((v) => (v === undefined || v === null || v === "" ? undefined : String(v))),
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

    const allRows = await opportunitiesRepo.getWorkingListRows();

    // Per-user scoping: COO/CEO/CCO see everything (canViewAllTickets);
    // Project Developers and other PD-eligible roles only see opportunities
    // where they are the PD-shadow project developer OR (when no PD override
    // exists) the Pipedrive deal owner.
    const userId = req.user?.id ?? null;
    const role = getUserRole(req);
    const seesAll = canViewAllTickets(role);
    let rows = seesAll
      ? allRows
      : allRows.filter(r => {
          if (userId == null) return false;
          if (r.pdProjectDeveloperUserId != null) return r.pdProjectDeveloperUserId === userId;
          return r.dealOwnerUserId === userId;
        });

    // Defensive dedupe: getWorkingOpportunities does a leftJoin on pd_tickets
    // and, while the partial-unique index normally enforces 1:1, real-world
    // data has shown duplicate shadow rows (e.g. one with project_id null
    // and an older one with project_id set) sneaking through. That produces
    // duplicate React keys on the client and a runtime crash. Dedupe by
    // opportunity id, preferring the first row (already ordered by
    // updatedAt desc). 2026-04-21 hotfix.
    {
      const seen = new Set<number>();
      const deduped: typeof rows = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        deduped.push(r);
      }
      rows = deduped;
    }

    const opportunityIds = rows.map(r => r.id);
    if (opportunityIds.length === 0) return res.json([]);

    const [linkedProjectCounts, engineeringTicketSummaries, linkedProjects] = await Promise.all([
      opportunitiesRepo.getLinkedProjectCounts(opportunityIds),
      opportunitiesRepo.getEngineeringTicketSummaries(opportunityIds),
      opportunitiesRepo.getLinkedProjectsByOpportunity(opportunityIds),
    ]);

    const projectCountByOpportunity = new Map<number, number>();
    for (const r of linkedProjectCounts) {
      if (r.opportunityId != null) projectCountByOpportunity.set(r.opportunityId, r.count);
    }
    const ticketSummaryByOpportunity = new Map<number, typeof engineeringTicketSummaries[number]>();
    for (const r of engineeringTicketSummaries) {
      ticketSummaryByOpportunity.set(r.opportunityId, r);
    }
    const linkedProjectByOpportunity = new Map<number, { projectId: number; projectName: string | null }>();
    for (const r of linkedProjects) {
      linkedProjectByOpportunity.set(r.opportunityId, { projectId: r.projectId, projectName: r.projectName });
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

        // Project Developer = PD-side override (pd_tickets) ► Pipedrive owner.
        // Province = opportunity column (Pipedrive) ► PD shadow fallback.
        const pipedriveOwner = r.dealOwnerUserName || r.dealOwnerNameSnapshot || null;
        const projectDeveloper = r.pdProjectDeveloperUserName || pipedriveOwner;
        const province = r.province || r.pdProvince || null;

        return {
          id: r.id,
          dealName,
          pipedriveDealId: r.pipedriveDealId,
          orgClientName: r.clientName || null,
          dealOwner: pipedriveOwner,
          projectDeveloper,
          projectDeveloperOverridden: Boolean(r.pdProjectDeveloperUserName && r.pdProjectDeveloperUserName !== pipedriveOwner),
          stage: r.stage || null,
          status: r.status || null,
          siteLocation: r.siteName || r.siteAddress || null,
          province,
          fundingType: r.fundingType || null,
          estimatedValue: r.estimatedValue != null ? Number(r.estimatedValue) : null,
          estimatedKwp: r.estimatedKwp != null ? Number(r.estimatedKwp) : null,
          nextActivityDate: r.nextActivityDate || null,
          nextActivitySubject: r.nextActivitySubject || null,
          hasLinkedClient: Boolean(r.clientId),
          hasLinkedProject,
          linkedProjectCount,
          linkedProjectId: linkedProjectByOpportunity.get(r.id)?.projectId ?? null,
          linkedProjectName: linkedProjectByOpportunity.get(r.id)?.projectName ?? null,
          openEngineeringTaskCount: ticketSummaryByOpportunity.get(r.id)?.openCount ?? 0,
          closedEngineeringTaskCount: ticketSummaryByOpportunity.get(r.id)?.closedCount ?? 0,
          oldestOpenEngineeringAt: ticketSummaryByOpportunity.get(r.id)?.oldestOpenAt
            ? ticketSummaryByOpportunity.get(r.id)!.oldestOpenAt!.toISOString()
            : null,
          // When tickets already exist for this deal, the latest ticket's
          // client/project is the natural default for "+ another ticket"
          // — surfaces these so the UI can skip the mapping dialog.
          lastTicketClientId: ticketSummaryByOpportunity.get(r.id)?.lastTicketClientId ?? null,
          lastTicketProjectId: ticketSummaryByOpportunity.get(r.id)?.lastTicketProjectId ?? null,
          existingEngineeringTicketCount:
            (ticketSummaryByOpportunity.get(r.id)?.openCount ?? 0) +
            (ticketSummaryByOpportunity.get(r.id)?.closedCount ?? 0), // alias for legacy callers (now total, not just open)
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
 * GET /api/pd/dashboard/pipeline-by-phase
 * Read-only roll-up of ACTIVE opportunities grouped by canonical
 * lifecycle phase, plus the flat list of those opportunities (with
 * expected close date) so the PD Dashboard can render both the
 * Pipeline-by-phase KPI card and the Expected sign-dates calendar
 * from a single round-trip.
 *
 * Excludes:
 *   - opportunities.deleted_at IS NOT NULL
 *   - opportunities.stage IN ('won','lost')
 *   - opportunities.status IN ('won','lost')
 *   - opportunities tied to a soft-deleted client
 *
 * Phase resolution:
 *   - opportunities.stage (CRM stage like 'prospect' / 'proposal')
 *     is mapped to a canonical CanonicalPhase via pdStageToLifecycle.
 *   - Opportunities whose stage cannot be mapped fall under '_UNSCOPED'
 *     so nothing is silently dropped.
 *
 * Added 2026-04-24 (task #77). Schema-additive zero — uses existing
 * opportunities.estimated_kwp, expected_close_date and estimated_value
 * columns.
 */
router.get("/api/pd/dashboard/pipeline-by-phase", requireAuth, requirePermission("pd_dashboard", "view"), async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(o.deal_name), ''), NULLIF(TRIM(c.name), ''), 'Opportunity #' || o.id::text) AS deal_name,
        c.name AS client_name,
        LOWER(COALESCE(o.stage, '')) AS stage,
        o.pipedrive_deal_id,
        o.estimated_kwp,
        o.estimated_value,
        o.expected_close_date::text AS expected_close_date,
        o.next_activity_date::text  AS next_activity_date
      FROM opportunities o
      LEFT JOIN clients c ON c.id = o.client_id AND c.deleted_at IS NULL
      WHERE o.deleted_at IS NULL
        -- Substring match catches CRM variants like 'won - signed', ' WON ',
        -- 'lost - no budget', etc. that exact equality would miss.
        AND POSITION('won'  IN LOWER(COALESCE(o.stage,  ''))) = 0
        AND POSITION('lost' IN LOWER(COALESCE(o.stage,  ''))) = 0
        AND POSITION('won'  IN LOWER(COALESCE(o.status, ''))) = 0
        AND POSITION('lost' IN LOWER(COALESCE(o.status, ''))) = 0
        -- A signed deal is no longer in the active sales pipeline.
        AND o.signed_date IS NULL
        AND (o.client_id IS NULL OR c.id IS NOT NULL)
      ORDER BY o.id
    `);

    type Row = {
      id: number;
      deal_name: string;
      client_name: string | null;
      stage: string | null;
      pipedrive_deal_id: string | null;
      estimated_kwp: string | number | null;
      estimated_value: string | number | null;
      expected_close_date: string | null;
      next_activity_date: string | null;
    };

    const rawRows = (result.rows ?? []) as Row[];

    const enriched = rawRows.map((r) => {
      const phase = pdStageToLifecycle(r.stage ?? null);
      const kwp = r.estimated_kwp == null ? null : Number(r.estimated_kwp);
      const value = r.estimated_value == null ? null : Number(r.estimated_value);
      return {
        id: Number(r.id),
        dealName: r.deal_name,
        clientName: r.client_name,
        stage: r.stage,
        pipedriveDealId: r.pipedrive_deal_id,
        phaseCode: phase?.code ?? null,
        phaseLabel: phase?.label ?? "Unscoped",
        phaseDisplayNumber: phase?.displayNumber ?? 99,
        estimatedKwp: kwp != null && Number.isFinite(kwp) ? kwp : null,
        estimatedValue: value != null && Number.isFinite(value) ? value : null,
        expectedCloseDate: r.expected_close_date,
        nextActivityDate: r.next_activity_date,
      };
    });

    type PhaseAgg = {
      code: string;
      label: string;
      displayNumber: number;
      count: number;
      totalKwp: number;
      totalValue: number;
    };
    const phaseAgg = new Map<string, PhaseAgg>();
    for (const r of enriched) {
      const code = r.phaseCode ?? "_UNSCOPED";
      const meta = code === "_UNSCOPED"
        ? { label: "Unscoped", displayNumber: 99 }
        : (PHASE_BY_CODE[code] ?? { label: r.phaseLabel, displayNumber: r.phaseDisplayNumber });
      const existing = phaseAgg.get(code) ?? {
        code,
        label: meta.label,
        displayNumber: meta.displayNumber,
        count: 0,
        totalKwp: 0,
        totalValue: 0,
      };
      existing.count += 1;
      existing.totalKwp += r.estimatedKwp ?? 0;
      existing.totalValue += r.estimatedValue ?? 0;
      phaseAgg.set(code, existing);
    }

    const totalKwp = Array.from(phaseAgg.values()).reduce((s, p) => s + p.totalKwp, 0);
    const totalCount = enriched.length;
    const totalValue = Array.from(phaseAgg.values()).reduce((s, p) => s + p.totalValue, 0);

    const byPhase = Array.from(phaseAgg.values())
      .map((p) => ({
        ...p,
        sharePct: totalKwp > 0 ? (p.totalKwp / totalKwp) * 100 : 0,
      }))
      .sort((a, b) => a.displayNumber - b.displayNumber);

    res.json({
      generatedAt: new Date().toISOString(),
      totals: { count: totalCount, totalKwp, totalValue },
      byPhase,
      rows: enriched.map((r) => ({
        id: r.id,
        dealName: r.dealName,
        clientName: r.clientName,
        stage: r.stage,
        pipedriveDealId: r.pipedriveDealId,
        phaseCode: r.phaseCode,
        phaseLabel: r.phaseLabel,
        estimatedKwp: r.estimatedKwp,
        estimatedValue: r.estimatedValue,
        expectedCloseDate: r.expectedCloseDate,
        nextActivityDate: r.nextActivityDate,
      })),
    });
  } catch (err) {
    console.error("[Opportunities] pipeline-by-phase failed:", err);
    res.status(500).json({ error: "Failed to load pipeline-by-phase" });
  }
});

/**
 * GET /api/pd/dashboard
 * Aggregated KPIs for the Project Development Dashboard.
 * Read-only: aggregates the opportunities table (incl. enriched Pipedrive cols).
 *
 * Returns:
 *   summary    — pipeline value, weighted value, active/won/lost counts, win rate, avg probability
 *   byStage    — count + value + weighted per active stage
 *   atRisk     — counts of stale-activity & high-value-no-activity active deals
 *   recentWins — last 5 won deals
 *   recentLost — last 5 lost deals (with reason)
 *   activity   — upcoming activities (next 14d) and overdue counts
 *   pipeline   — last 90d won-vs-lost weekly buckets (for sparkline)
 */
// ============================================================================
// /api/pd/dashboard — App-internal Project Development dashboard.
// Task #71: app-internal sources (engineering_tickets, work_items, project_info,
// project_execution_state, raid_items, om_handovers, users). Drilldowns target
// /engineering/tickets, /engineering/tasks, /project/<name>.
// ============================================================================
router.get("/api/pd/dashboard", requireAuth, requirePermission("pd_dashboard", "view"), async (_req: Request, res: Response) => {
  try {
    const [
      ticketTotalsRow,
      workItemTotalsRow,
      handoverRow,
      byPhaseRows,
      byOwnerRows,
      actionQueueRows,
      recentlyCompletedRows,
      upcomingThisWeekRows,
      atRiskRows,
      linkageGapRows,
    ] = await Promise.all([
      // Engineering-ticket totals. "Active" = not in a terminal status.
      // "Overdue" = active AND due_date in the past. "Stale 30d" =
      // active AND last activity (latest related work_items.updated_at,
      // falling back to ticket updated_at) older than 30d. "Blocked" =
      // active AND has at least one open work_item in 'hold' status.
      db.execute(sql`
        WITH t AS (
          SELECT
            et.id,
            et.status,
            et.due_date,
            et.updated_at,
            et.size_kwp,
            -- Latest activity = max work-item update for this ticket,
            -- falling back to the ticket's own updated_at when no work
            -- items exist. Used to compute the stale-30d signal so that
            -- a quiet ticket with active work items isn't flagged stale.
            GREATEST(
              et.updated_at,
              COALESCE(
                (SELECT MAX(w2.updated_at) FROM work_items w2
                 WHERE w2.engineering_ticket_id = et.id AND w2.deleted_at IS NULL),
                et.updated_at
              )
            ) AS last_activity_at,
            EXISTS (
              SELECT 1 FROM work_items w
              WHERE w.engineering_ticket_id = et.id
                AND w.deleted_at IS NULL
                AND LOWER(COALESCE(w.status, '')) IN ('hold', 'blocked', 'on_hold')
            ) AS has_blocker
          FROM engineering_tickets et
          WHERE et.deleted_at IS NULL
        ),
        active AS (
          SELECT * FROM t
          WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
        )
        SELECT
          (SELECT COUNT(*) FROM active) AS active_tickets,
          (SELECT COUNT(*) FROM active WHERE due_date IS NOT NULL AND due_date::date < CURRENT_DATE) AS overdue_tickets,
          (SELECT COUNT(*) FROM active WHERE last_activity_at < NOW() - INTERVAL '30 days') AS stale30_tickets,
          (SELECT COUNT(*) FROM active WHERE has_blocker) AS blocked_tickets,
          -- Engineering-board "in approval" sub-states: tickets that are
          -- waiting on a human review gate before they can move to complete.
          -- See shared/engineering-ticket-status.ts::TICKET_APPROVAL_STATUSES.
          (SELECT COUNT(*) FROM active WHERE LOWER(COALESCE(status, '')) IN ('needs_approval', 'qc_approved', 'provide_feedback', 'operational_approval')) AS in_approval_tickets,
          (SELECT COUNT(*) FROM t WHERE LOWER(COALESCE(status, '')) IN ('completed', 'complete', 'closed', 'resolved', 'done')) AS completed_tickets,
          (SELECT COALESCE(SUM(size_kwp), 0) FROM active) AS active_kwp
      `),
      // Work-item totals scoped to items linked to engineering tickets
      // (the PD operating surface). Counts open / overdue / due-this-week /
      // completed-last-14d for the top-strip context band.
      db.execute(sql`
        WITH w AS (
          SELECT
            wi.id, wi.status, wi.end_date, wi.completed_at, wi.actual_end
          FROM work_items wi
          WHERE wi.deleted_at IS NULL
            AND wi.engineering_ticket_id IS NOT NULL
        )
        SELECT
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
          ) AS open_work_items,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
              AND NULLIF(end_date, '') IS NOT NULL
              AND NULLIF(end_date, '')::date < CURRENT_DATE
          ) AS overdue_work_items,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
              AND NULLIF(end_date, '') IS NOT NULL
              AND NULLIF(end_date, '')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          ) AS due_this_week_work_items,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(status, '')) IN ('completed', 'complete', 'closed', 'resolved', 'done')
              AND COALESCE(completed_at, actual_end::timestamp) >= NOW() - INTERVAL '14 days'
          ) AS completed_14d_work_items
        FROM w
      `),
      // Handover-ready: count of active projects whose O&M handover
      // record (om_handovers — the closest existing analogue of the
      // task-spec "handover_meeting_capture") shows the deliverables are
      // assembled but actual handover hasn't happened yet. Specifically:
      // deleted_at IS NULL, actual_handover_date IS NULL, AND at least
      // the three core packs are uploaded (as_builts + warranties +
      // O&M manual). The project's canonical phase is also surfaced so
      // the UI can label which handover band the project sits in.
      db.execute(sql`
        WITH hr AS (
          SELECT
            pi.id,
            pi.project_name,
            pes.current_stage_code AS phase,
            pes.rag_status
          FROM project_info pi
          JOIN om_handovers omh
            ON omh.project_id = pi.id
            AND omh.deleted_at IS NULL
            AND omh.actual_handover_date IS NULL
            AND COALESCE(omh.as_builts_uploaded, false) = true
            AND COALESCE(omh.warranties_uploaded, false) = true
            AND COALESCE(omh.om_manual_uploaded, false) = true
          LEFT JOIN project_execution_state pes
            ON pes.project_id = pi.id AND pes.deleted_at IS NULL
          WHERE pi.deleted_at IS NULL
            AND pi.project_status = 'active'
        )
        SELECT
          (SELECT COUNT(*) FROM hr) AS total,
          COALESCE(json_agg(row_to_json(t) ORDER BY t.project_name) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS items
        FROM (SELECT * FROM hr ORDER BY project_name LIMIT 8) t
      `),
      // By canonical phase: scope to ACTIVE engineering tickets and
      // roll up open / overdue work items by canonical stage code.
      //
      // Phase derivation per ticket:
      //   1. If the ticket has any work items, use the most-recently
      //      updated work item's `phase` (already canonical).
      //   2. If that's missing, fall back to mapping the ticket's
      //      `request_type` to a canonical phase (mirrors the static
      //      table in shared/utils/phase-to-stage-map.ts so the SQL
      //      doesn't need to import TS).
      //   3. Otherwise '_UNSCOPED'.
      //
      // Open / overdue work-item counts also flow through the same
      // active-ticket scoping so a phase row only reflects work that's
      // actually in flight.
      db.execute(sql`
        WITH active_tickets AS (
          SELECT
            et.id,
            et.request_type,
            -- (1) preferred: latest work-item phase for this ticket
            (
              SELECT wi.phase
              FROM work_items wi
              WHERE wi.engineering_ticket_id = et.id
                AND wi.deleted_at IS NULL
                AND wi.phase IS NOT NULL
              ORDER BY wi.updated_at DESC NULLS LAST
              LIMIT 1
            ) AS wi_phase
          FROM engineering_tickets et
          WHERE et.deleted_at IS NULL
            AND LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
        ),
        ticket_phase AS (
          SELECT
            id AS ticket_id,
            COALESCE(
              wi_phase,
              -- (2) fallback: request_type → canonical phase
              CASE
                WHEN request_type ILIKE 'First Assessment%' THEN 'S01_FIRST_ASSESSMENT'
                WHEN request_type IN ('Cost Proposal', 'CP - PVSOL', 'Feasibility Study', 'Sizing Rational Request', 'Design & Cost Proposal') THEN 'S02_DESIGN_COST_PROPOSAL'
                WHEN request_type IN ('Site visit Report', 'Data Analysis Request', 'Meter installation') THEN 'S01_FIRST_ASSESSMENT'
                ELSE NULL
              END,
              '_UNSCOPED'
            ) AS code
          FROM active_tickets
        ),
        wi_rollup AS (
          SELECT
            tp.code,
            wi.id AS wi_id,
            wi.status,
            wi.end_date
          FROM ticket_phase tp
          JOIN work_items wi
            ON wi.engineering_ticket_id = tp.ticket_id
            AND wi.deleted_at IS NULL
        )
        SELECT
          code,
          (SELECT COUNT(*) FROM ticket_phase tp2 WHERE tp2.code = w.code) AS ticket_count,
          -- IMPORTANT: gate counts on (w.wi_id IS NOT NULL) so the synthetic
          -- placeholder rows (used only to ensure phases with zero work
          -- items still appear) never inflate work-item totals.
          COUNT(*) FILTER (
            WHERE w.wi_id IS NOT NULL
              AND LOWER(COALESCE(w.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
          ) AS open_work_items,
          COUNT(*) FILTER (
            WHERE w.wi_id IS NOT NULL
              AND LOWER(COALESCE(w.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
              AND NULLIF(w.end_date, '') IS NOT NULL
              AND NULLIF(w.end_date, '')::date < CURRENT_DATE
          ) AS overdue_work_items
        FROM (
          -- Synthetic placeholder per phase keeps zero-work-item phases visible;
          -- gated out of every COUNT FILTER above via (w.wi_id IS NOT NULL).
          SELECT code, NULL::int AS wi_id, NULL::text AS status, NULL::text AS end_date FROM ticket_phase
          UNION ALL
          SELECT code, wi_id, status, end_date FROM wi_rollup
        ) w
        GROUP BY code
      `),
      // By owner: per-PD-developer rollup of active engineering tickets.
      // Owner identity is the engineering_tickets.project_developer_user_id
      // joined to users.name (no Pipedrive snapshot). Unassigned tickets
      // bucket under "Unassigned" so they remain visible.
      db.execute(sql`
        SELECT
          et.project_developer_user_id AS owner_user_id,
          COALESCE(NULLIF(TRIM(u.name), ''), 'Unassigned') AS owner,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
          ) AS active,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
              AND et.due_date IS NOT NULL AND et.due_date::date < CURRENT_DATE
          ) AS overdue,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
              AND GREATEST(
                et.updated_at,
                COALESCE(
                  (SELECT MAX(w2.updated_at) FROM work_items w2
                   WHERE w2.engineering_ticket_id = et.id AND w2.deleted_at IS NULL),
                  et.updated_at
                )
              ) < NOW() - INTERVAL '30 days'
          ) AS stale30,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
              AND et.due_date IS NOT NULL
              AND et.due_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          ) AS due_this_week,
          COALESCE(SUM(et.size_kwp) FILTER (
            WHERE LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
          ), 0) AS active_kwp
        FROM engineering_tickets et
        LEFT JOIN users u ON u.id = et.project_developer_user_id
        WHERE et.deleted_at IS NULL
        GROUP BY 1, 2
        HAVING COUNT(*) FILTER (
          WHERE LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
        ) > 0
        ORDER BY active DESC, owner ASC
        LIMIT 25
      `),
      // Action queue: top open work_items needing action right now,
      // ranked by reason. Each row carries a deterministic reason chip.
      // Order (per task spec): overdue → on-hold → stale_30d →
      // high-priority quiet. Overdue is ranked first because it is the
      // hardest commitment (a missed end_date), ahead of an explicit
      // hold which at least carries a reason.
      db.execute(sql`
        WITH ranked AS (
          SELECT
            wi.id AS work_item_id,
            wi.title,
            wi.engineering_ticket_id,
            et.project_site_name,
            wi.phase,
            wi.priority,
            wi.end_date,
            wi.status,
            wi.updated_at,
            COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(wi.owner_name), ''), 'Unassigned') AS owner,
            CASE
              WHEN NULLIF(wi.end_date, '') IS NOT NULL AND NULLIF(wi.end_date, '')::date < CURRENT_DATE THEN 'overdue'
              WHEN LOWER(COALESCE(wi.status, '')) IN ('hold', 'blocked', 'on_hold') THEN 'on_hold'
              WHEN wi.updated_at < NOW() - INTERVAL '30 days' THEN 'stale_30d'
              WHEN LOWER(COALESCE(wi.priority, '')) IN ('high', 'critical') AND wi.updated_at < NOW() - INTERVAL '7 days' THEN 'high_priority_quiet'
              ELSE NULL
            END AS reason
          FROM work_items wi
          JOIN engineering_tickets et ON et.id = wi.engineering_ticket_id AND et.deleted_at IS NULL
          LEFT JOIN users u ON u.id = wi.owner_user_id
          WHERE wi.deleted_at IS NULL
            AND wi.engineering_ticket_id IS NOT NULL
            AND LOWER(COALESCE(wi.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
        )
        SELECT
          work_item_id, title, engineering_ticket_id, project_site_name,
          phase, priority, end_date, status, owner, reason
        FROM ranked
        WHERE reason IS NOT NULL
        ORDER BY
          CASE reason
            WHEN 'overdue' THEN 1
            WHEN 'on_hold' THEN 2
            WHEN 'stale_30d' THEN 3
            WHEN 'high_priority_quiet' THEN 4
          END ASC,
          end_date ASC NULLS LAST,
          updated_at ASC
        LIMIT 12
      `),
      // Recently completed (last 14d) — work items linked to engineering
      // tickets, used as a "what got done" pulse. Resolves owner via FK
      // first then falls back to denormalised owner_name.
      db.execute(sql`
        SELECT
          wi.id AS work_item_id,
          wi.title,
          wi.engineering_ticket_id,
          et.project_site_name,
          COALESCE(wi.completed_at, wi.actual_end::timestamp) AS completed_at,
          COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(wi.owner_name), ''), 'Unassigned') AS owner
        FROM work_items wi
        JOIN engineering_tickets et ON et.id = wi.engineering_ticket_id AND et.deleted_at IS NULL
        LEFT JOIN users u ON u.id = wi.owner_user_id
        WHERE wi.deleted_at IS NULL
          AND wi.engineering_ticket_id IS NOT NULL
          AND LOWER(COALESCE(wi.status, '')) IN ('completed', 'complete', 'closed', 'resolved', 'done')
          AND COALESCE(wi.completed_at, wi.actual_end::timestamp) >= NOW() - INTERVAL '14 days'
        ORDER BY COALESCE(wi.completed_at, wi.actual_end::timestamp) DESC
        LIMIT 10
      `),
      // Upcoming this week — open work items due in the next 7 days.
      db.execute(sql`
        SELECT
          wi.id AS work_item_id,
          wi.title,
          wi.engineering_ticket_id,
          et.project_site_name,
          wi.end_date,
          wi.priority,
          COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(wi.owner_name), ''), 'Unassigned') AS owner
        FROM work_items wi
        JOIN engineering_tickets et ON et.id = wi.engineering_ticket_id AND et.deleted_at IS NULL
        LEFT JOIN users u ON u.id = wi.owner_user_id
        WHERE wi.deleted_at IS NULL
          AND wi.engineering_ticket_id IS NOT NULL
          AND LOWER(COALESCE(wi.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
          AND NULLIF(wi.end_date, '') IS NOT NULL
          AND NULLIF(wi.end_date, '')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        ORDER BY NULLIF(wi.end_date, '')::date ASC
        LIMIT 10
      `),
      // At-risk tickets — engineering tickets that have either:
      //   (a) at least one open work_item with tracking_rag = 'red', or
      //   (b) a linked project_info with at least one open RAID item at
      //       'high' or 'critical' priority.
      db.execute(sql`
        WITH red_wi AS (
          SELECT
            wi.engineering_ticket_id AS ticket_id,
            COUNT(*) AS red_count
          FROM work_items wi
          WHERE wi.deleted_at IS NULL
            AND wi.engineering_ticket_id IS NOT NULL
            AND LOWER(COALESCE(wi.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done')
            AND LOWER(COALESCE(wi.tracking_rag, '')) = 'red'
          GROUP BY 1
        ),
        crit_raid AS (
          SELECT
            ri.project_id,
            COUNT(*) AS crit_count
          FROM raid_items ri
          WHERE ri.deleted_at IS NULL
            AND ri.status IN ('open', 'mitigating')
            AND ri.priority IN ('high', 'critical')
          GROUP BY 1
        )
        SELECT
          et.id AS ticket_id,
          et.project_site_name,
          COALESCE(NULLIF(TRIM(u.name), ''), 'Unassigned') AS owner,
          COALESCE(rw.red_count, 0) AS red_work_item_count,
          COALESCE(cr.crit_count, 0) AS open_critical_raid_count
        FROM engineering_tickets et
        LEFT JOIN users u ON u.id = et.project_developer_user_id
        LEFT JOIN red_wi rw ON rw.ticket_id = et.id
        LEFT JOIN crit_raid cr ON cr.project_id = et.project_id
        WHERE et.deleted_at IS NULL
          AND LOWER(COALESCE(et.status, '')) NOT IN ('completed', 'complete', 'closed', 'resolved', 'done', 'cancelled', 'canceled')
          AND (rw.red_count > 0 OR cr.crit_count > 0)
        ORDER BY (COALESCE(rw.red_count, 0) + COALESCE(cr.crit_count, 0)) DESC
        LIMIT 10
      `),
      // Linkage gaps: spine breakage between opportunities, tickets, projects.
      //   unlinked_ticket / completed_no_project / won_no_project / project_no_tickets.
      // For won_no_project the label is the opportunity's own name column
      // (opportunities.deal_name is the canonical opportunity name post-merge,
      // task #61); falls back to person_name then a synthetic id.
      db.execute(sql`
        SELECT 'unlinked_ticket' AS kind, et.id AS id, et.project_site_name AS label
        FROM engineering_tickets et
        WHERE et.deleted_at IS NULL
          AND et.project_id IS NULL
          AND et.opportunity_id IS NULL
          AND LOWER(COALESCE(et.status, '')) NOT IN ('cancelled', 'canceled', 'completed', 'complete', 'closed', 'resolved', 'done')
        UNION ALL
        SELECT 'completed_no_project' AS kind, et.id AS id, et.project_site_name AS label
        FROM engineering_tickets et
        WHERE et.deleted_at IS NULL
          AND et.project_id IS NULL
          AND LOWER(COALESCE(et.status, '')) IN ('completed', 'complete', 'closed', 'resolved', 'done')
        UNION ALL
        SELECT 'won_no_project' AS kind, opp.id AS id,
               ('Opportunity #' || opp.id) AS label
        FROM opportunities opp
        WHERE opp.deleted_at IS NULL
          AND LOWER(COALESCE(opp.status, '')) = 'won'
          AND NOT EXISTS (
            SELECT 1 FROM project_info pi
            WHERE pi.opportunity_id = opp.id AND pi.deleted_at IS NULL
          )
        UNION ALL
        SELECT 'project_no_tickets' AS kind, pi.id AS id, pi.project_name AS label
        FROM project_info pi
        WHERE pi.deleted_at IS NULL
          AND pi.project_status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM engineering_tickets et
            WHERE et.project_id = pi.id AND et.deleted_at IS NULL
          )
        ORDER BY 3
        LIMIT 50
      `),
    ]);

    const tt = (ticketTotalsRow.rows?.[0] ?? {}) as Record<string, any>;
    const wt = (workItemTotalsRow.rows?.[0] ?? {}) as Record<string, any>;
    const hr = (handoverRow.rows?.[0] ?? {}) as Record<string, any>;

    // byPhase — augment with display label from canonical PHASES.
    const phaseAcc = new Map<string, { code: string; label: string; ticketCount: number; openWorkItems: number; overdueWorkItems: number }>();
    for (const code of PHASES.map(p => p.code)) {
      phaseAcc.set(code, { code, label: PHASE_BY_CODE[code]?.label ?? code, ticketCount: 0, openWorkItems: 0, overdueWorkItems: 0 });
    }
    for (const r of (byPhaseRows.rows ?? []) as any[]) {
      const code = String(r.code ?? '_UNSCOPED');
      const existing = phaseAcc.get(code);
      const row = existing ?? { code, label: PHASE_BY_CODE[code]?.label ?? (code === '_UNSCOPED' ? 'Unscoped' : code), ticketCount: 0, openWorkItems: 0, overdueWorkItems: 0 };
      row.ticketCount += Number(r.ticket_count ?? 0);
      row.openWorkItems += Number(r.open_work_items ?? 0);
      row.overdueWorkItems += Number(r.overdue_work_items ?? 0);
      if (!existing) phaseAcc.set(code, row);
    }
    const byPhase = Array.from(phaseAcc.values()).sort((a, b) => {
      const aIdx = PHASES.findIndex(p => p.code === a.code);
      const bIdx = PHASES.findIndex(p => p.code === b.code);
      // Unscoped/unknown go to the end
      const aOrder = aIdx === -1 ? 99 : aIdx;
      const bOrder = bIdx === -1 ? 99 : bIdx;
      return aOrder - bOrder;
    });

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        activeTickets: Number(tt.active_tickets ?? 0),
        overdueTickets: Number(tt.overdue_tickets ?? 0),
        stale30Tickets: Number(tt.stale30_tickets ?? 0),
        blockedTickets: Number(tt.blocked_tickets ?? 0),
        inApprovalTickets: Number(tt.in_approval_tickets ?? 0),
        completedTickets: Number(tt.completed_tickets ?? 0),
        activeKwp: Number(tt.active_kwp ?? 0),
        openWorkItems: Number(wt.open_work_items ?? 0),
        overdueWorkItems: Number(wt.overdue_work_items ?? 0),
        dueThisWeekWorkItems: Number(wt.due_this_week_work_items ?? 0),
        completed14dWorkItems: Number(wt.completed_14d_work_items ?? 0),
      },
      byPhase,
      byOwner: (byOwnerRows.rows ?? []).map((r: any) => ({
        ownerUserId: r.owner_user_id != null ? Number(r.owner_user_id) : null,
        owner: String(r.owner ?? 'Unassigned'),
        active: Number(r.active ?? 0),
        overdue: Number(r.overdue ?? 0),
        stale30: Number(r.stale30 ?? 0),
        dueThisWeek: Number(r.due_this_week ?? 0),
        activeKwp: Number(r.active_kwp ?? 0),
      })),
      handoverReady: {
        total: Number(hr.total ?? 0),
        items: (((hr.items ?? []) as any[])).map((it) => ({
          id: Number(it.id),
          projectName: it.project_name ?? null,
          phase: it.phase ?? null,
          phaseLabel: it.phase ? (PHASE_BY_CODE[it.phase]?.label ?? it.phase) : null,
          ragStatus: it.rag_status ?? null,
        })),
      },
      actionQueue: (actionQueueRows.rows ?? []).map((r: any) => ({
        workItemId: Number(r.work_item_id),
        title: r.title ?? null,
        ticketId: r.engineering_ticket_id != null ? Number(r.engineering_ticket_id) : null,
        ticketName: r.project_site_name ?? null,
        phase: r.phase ?? null,
        phaseLabel: r.phase ? (PHASE_BY_CODE[r.phase]?.label ?? r.phase) : null,
        priority: r.priority ?? null,
        endDate: r.end_date ?? null,
        owner: r.owner ?? null,
        reason: String(r.reason ?? ''),
      })),
      // Recently completed (14d) — grouped by engineering ticket per task #71 spec.
      recentlyCompleted: (() => {
        const groups = new Map<string, { ticketId: number | null; ticketName: string | null; items: any[] }>();
        for (const r of (recentlyCompletedRows.rows ?? []) as any[]) {
          const ticketId = r.engineering_ticket_id != null ? Number(r.engineering_ticket_id) : null;
          const key = ticketId == null ? "_orphan" : String(ticketId);
          let g = groups.get(key);
          if (!g) {
            g = { ticketId, ticketName: r.project_site_name ?? null, items: [] };
            groups.set(key, g);
          }
          g.items.push({
            workItemId: Number(r.work_item_id),
            title: r.title ?? null,
            completedAt: r.completed_at ?? null,
            owner: r.owner ?? null,
          });
        }
        return Array.from(groups.values());
      })(),
      upcomingThisWeek: (upcomingThisWeekRows.rows ?? []).map((r: any) => ({
        workItemId: Number(r.work_item_id),
        title: r.title ?? null,
        ticketId: r.engineering_ticket_id != null ? Number(r.engineering_ticket_id) : null,
        ticketName: r.project_site_name ?? null,
        endDate: r.end_date ?? null,
        priority: r.priority ?? null,
        owner: r.owner ?? null,
      })),
      atRiskTickets: (atRiskRows.rows ?? []).map((r: any) => ({
        ticketId: Number(r.ticket_id),
        ticketName: r.project_site_name ?? null,
        owner: r.owner ?? null,
        redWorkItemCount: Number(r.red_work_item_count ?? 0),
        openCriticalRaidCount: Number(r.open_critical_raid_count ?? 0),
      })),
      linkageGaps: (() => {
        const items = (linkageGapRows.rows ?? []).map((r: any) => ({
          kind: String(r.kind),
          id: Number(r.id),
          label: r.label ?? null,
        }));
        return { total: items.length, items: items.slice(0, 12) };
      })(),
    });
  } catch (err) {
    console.error("[Opportunities] Failed to compute PD dashboard:", err);
    res.status(500).json({ error: "Failed to compute PD dashboard" });
  }
});


/**
 * Phase templates are global — the endpoint does not use an opportunity ID.
 * Legacy URL with :id is kept as an alias for backwards compatibility.
 */
router.get("/api/opportunities/engineering-phase-templates", requireAuth, requirePermission("pd_tickets", "view"), async (req: Request, res: Response) => {
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
router.get("/api/opportunities/:id/engineering-phase-templates", requireAuth, requirePermission("pd_tickets", "view"), async (req: Request, res: Response) => {
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
      const ct = parsed.customTicket;
      ticketValues = [{
        clientId: parsed.clientId,
        clientNameSnapshot: clientRow.name,
        ...(ct.fundingType ? { fundingType: ct.fundingType } : {}),
        ...(ct.sizeKwp ? { sizeKwp: ct.sizeKwp } : {}),
        ...(ct.province ? { province: ct.province } : {}),
        ...(ct.gpsCoordinates ? { gpsCoordinates: ct.gpsCoordinates } : {}),
        ...(ct.batteriesNeeded !== undefined ? { batteriesNeeded: ct.batteriesNeeded } : {}),
        ...(ct.batterySize ? { batterySize: ct.batterySize } : {}),
        projectId: parsed.projectId,
        opportunityId,
        projectSiteName: parsed.customTicket.title,
        requestType: parsed.customTicket.phase,
        dueDate: parsed.customTicket.dueDate,
        priority: parsed.customTicket.priority,
        status: "to_do",
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
        status: "to_do",
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
    // Surface the real error so the UI toast shows something actionable
    // instead of a generic "Failed". These are internal users and the
    // most common causes (duplicate project shell, missing required
    // column, FK violations) are useful to see directly.
    const message = err instanceof Error ? err.message : "Failed to create engineering tickets";
    res.status(500).json({ error: message });
  }
});

router.get("/api/opportunities/:id/mapping-context", requireAuth, requirePermission("pd_tickets", "view"), async (req: Request, res: Response) => {
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

    // Back-link the opportunity onto the resolved (existing) project so it
    // disappears from the Opportunities working list as "converted". The
    // shell-creation branch already sets `opportunity_id` at insert time;
    // this covers the `existing_existing` path (and any prior orphaned
    // existing project that has never been linked). `IfUnset` guards against
    // clobbering a different opportunity already pointing at this project.
    let backLinkedExistingProject = false;
    if (resolvedProject && !createdProjectShell) {
      backLinkedExistingProject = await opportunitiesRepo.linkProjectToOpportunityIfUnset(
        db,
        resolvedProject.id,
        opportunityId,
      );
      if (backLinkedExistingProject) {
        logAuditFromReq(req, {
          entityType: "project",
          entityId: String(resolvedProject.id),
          action: "back_link_to_opportunity",
          changesJson: { opportunityId, projectName: resolvedProject.projectName, mode: parsed.mode },
        });
      }
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
 * Unified merged-Opportunity read used by the new drawer (2026-04-20;
 * no-shadow contract reaffirmed 2026-04-24, Task #83).
 *
 * Returns CRM truth + the engineering PD shadow ticket (or `null` if
 * none exists yet) + spawned tasks in one payload. Auto-spawn was
 * removed 2026-04-23 — engineering shadow tickets are created only by
 * an explicit user action (the working list "create ticket" CTA),
 * never on read. The drawer is built to render successfully when
 * `pd === null`; see the file-header docblock in
 * client/src/components/opportunities/OpportunityDrawer.tsx.
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
  // Engineering-board canonical statuses (shared/engineering-ticket-status.ts).
  // Migration 0027 backfilled legacy free-form values, so the enum now only
  // accepts the canonical 10-state set.
  status: z.enum(ENGINEERING_TICKET_STATUSES).optional(),
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
  // Optional CRM stage override applied during convert. When provided,
  // takes precedence over the auto-bump-to-"won" behaviour below so a PD
  // can keep the deal in (e.g.) "negotiation" while a project shell is
  // being scoped. Allowed values mirror the canonical app stages on
  // opportunities.stage.
  stage: z.enum(["prospect", "qualification", "proposal", "negotiation", "won", "lost"]).optional(),
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

      const { projectInfo, engineeringTickets, opportunities: oppTable } = await import("@shared/schema/projects");
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
          .from(engineeringTickets)
          // Cascade-display: don't promote a soft-deleted shadow (Task #34).
          .where(and(eq(engineeringTickets.opportunityId, opportunityId), isNull(engineeringTickets.deletedAt)))
          .limit(1);
        if (shadow) {
          await tx
            .update(engineeringTickets)
            .set({
              projectId: project.id,
              // Convert-to-project closes out the engineering shadow ticket
              // (canonical engineering-board terminal state — migration 0027).
              status: "complete",
              sizeKwp: parsed.data.sizeKwp ?? shadow.sizeKwp,
              updatedAt: new Date(),
            })
            .where(eq(engineeringTickets.id, shadow.id));
        }

        // Stage write: explicit override (from the convert dialog) wins;
        // otherwise auto-bump to "won" only when the deal hasn't already
        // landed in a terminal state.
        if (parsed.data.stage) {
          await tx
            .update(oppTable)
            .set({ stage: parsed.data.stage, updatedAt: new Date() })
            .where(eq(oppTable.id, opportunityId));
        } else if (opp.status !== "won" && opp.status !== "lost") {
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
