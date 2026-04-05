/**
 * Finance Records API — Wave 5
 *
 * Unified transactional finance: POs, invoices, payments, VOs.
 * Reads/writes to finance.finance_records (promoted schema).
 *
 * Guardrail 1: Locked API contract.
 * Guardrail 2: Analytical tables (programExpense, programInflows) stay OUTSIDE core.
 * Guardrail 5: finance_record is TRANSACTIONAL, not analytical.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkPermission, requireAuth } from "../middleware/check-permission";

const router = Router();

/**
 * GET /api/projects/:projectInstanceId/finance-summary
 * Aggregated finance view for a project.
 */
router.get("/api/projects/:projectInstanceId/finance-summary", requireAuth, checkPermission("financials", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectInstanceId) ? req.params.projectInstanceId[0] : req.params.projectInstanceId;
    const projectInstanceId = parseInt(rawId);
    if (isNaN(projectInstanceId)) return res.status(400).json({ error: "Invalid project ID" });

    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE financial_type = 'purchase_order')::int AS po_count,
        COALESCE(SUM(amount_ex_vat) FILTER (WHERE financial_type = 'purchase_order' AND status != 'cancelled'), 0)::numeric AS total_committed,
        COALESCE(SUM(amount_ex_vat) FILTER (WHERE direction = 'outflow' AND status IN ('approved', 'paid')), 0)::numeric AS total_invoiced,
        COALESCE(SUM(amount_ex_vat) FILTER (WHERE direction = 'outflow' AND status = 'paid'), 0)::numeric AS total_paid,
        COALESCE(SUM(amount_ex_vat) FILTER (WHERE direction = 'inflow' AND status != 'cancelled'), 0)::numeric AS total_revenue,
        COALESCE(SUM(amount_ex_vat) FILTER (WHERE direction = 'inflow' AND status = 'paid'), 0)::numeric AS revenue_received,
        COUNT(*) FILTER (WHERE status = 'draft' OR status = 'submitted')::int AS pending_count
      FROM finance.finance_records
      WHERE project_instance_id = ${projectInstanceId}
    `);

    const summary = result.rows[0] as Record<string, any>;

    // Get budget baseline if available
    const budgetResult = await db.execute(sql`
      SELECT revenue_baseline, cos_baseline, margin_baseline, contingency
      FROM budget_baselines
      WHERE project_id = (
        SELECT legacy_project_id FROM core.project_instances WHERE id = ${projectInstanceId} LIMIT 1
      )
      ORDER BY version DESC
      LIMIT 1
    `);
    const budget = budgetResult.rows[0] as Record<string, any> | undefined;

    res.json({
      poCount: summary.po_count,
      totalCommitted: parseFloat(summary.total_committed) || 0,
      totalInvoiced: parseFloat(summary.total_invoiced) || 0,
      totalPaid: parseFloat(summary.total_paid) || 0,
      totalRevenue: parseFloat(summary.total_revenue) || 0,
      revenueReceived: parseFloat(summary.revenue_received) || 0,
      pendingCount: summary.pending_count,
      budget: budget ? {
        revenueBaseline: parseFloat(budget.revenue_baseline) || 0,
        cosBaseline: parseFloat(budget.cos_baseline) || 0,
        marginBaseline: parseFloat(budget.margin_baseline) || 0,
        contingency: parseFloat(budget.contingency) || 0,
      } : null,
      budgetVariance: budget ? parseFloat(budget.cos_baseline) - parseFloat(summary.total_committed) : null,
    });
  } catch (err) {
    console.error("[Finance] Failed to fetch summary:", err);
    res.status(500).json({ error: "Failed to fetch finance summary" });
  }
});

/**
 * GET /api/finance-records
 * List finance records with filtering.
 */
router.get("/api/finance-records", requireAuth, checkPermission("financials", "view"), async (req: Request, res: Response) => {
  try {
    const projectInstanceId = req.query.projectInstanceId ? parseInt(req.query.projectInstanceId as string) : undefined;
    const financialType = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const direction = req.query.direction as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    let whereClause = sql`WHERE 1=1`;
    if (projectInstanceId) whereClause = sql`${whereClause} AND fr.project_instance_id = ${projectInstanceId}`;
    if (financialType) whereClause = sql`${whereClause} AND fr.financial_type = ${financialType}`;
    if (status) whereClause = sql`${whereClause} AND fr.status = ${status}`;
    if (direction) whereClause = sql`${whereClause} AND fr.direction = ${direction}`;

    const result = await db.execute(sql`
      SELECT
        fr.id,
        fr.legacy_entity_id,
        fr.legacy_entity_table,
        fr.project_instance_id,
        fr.financial_type,
        fr.direction,
        fr.title,
        fr.amount_ex_vat,
        fr.vat_amount,
        fr.currency,
        fr.status,
        fr.record_data,
        fr.created_at,
        fr.updated_at,
        p.name_canonical AS party_name,
        fp.name AS fiscal_period_name
      FROM finance.finance_records fr
      LEFT JOIN core.parties p ON p.id = fr.party_id
      LEFT JOIN finance.fiscal_periods fp ON fp.id = fr.fiscal_period_id
      ${whereClause}
      ORDER BY fr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM finance.finance_records fr ${whereClause}
    `);

    res.json({
      records: result.rows,
      total: (countResult.rows[0] as { total: number })?.total ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[Finance] Failed to list records:", err);
    res.status(500).json({ error: "Failed to list finance records" });
  }
});

/**
 * GET /api/finance-records/:id
 * Detail with linked records and events.
 */
router.get("/api/finance-records/:id", requireAuth, checkPermission("financials", "view"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid finance record ID" });

    const recordResult = await db.execute(sql`
      SELECT
        fr.*,
        p.name_canonical AS party_name,
        fp.name AS fiscal_period_name
      FROM finance.finance_records fr
      LEFT JOIN core.parties p ON p.id = fr.party_id
      LEFT JOIN finance.fiscal_periods fp ON fp.id = fr.fiscal_period_id
      WHERE fr.id = ${id}
    `);

    if (recordResult.rows.length === 0) return res.status(404).json({ error: "Record not found" });

    const eventsResult = await db.execute(sql`
      SELECT
        fre.*,
        actor.name_canonical AS actor_name
      FROM finance.finance_record_events fre
      LEFT JOIN core.parties actor ON actor.id = fre.actor_party_id
      WHERE fre.finance_record_id = ${id}
      ORDER BY fre.event_at DESC
    `);

    res.json({
      record: recordResult.rows[0],
      events: eventsResult.rows,
    });
  } catch (err) {
    console.error("[Finance] Failed to fetch detail:", err);
    res.status(500).json({ error: "Failed to fetch finance record" });
  }
});

/**
 * POST /api/finance-records
 * Create a new finance record.
 */
router.post("/api/finance-records", requireAuth, checkPermission("financials", "create"), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { financialType, direction, projectInstanceId, partyId, title, amountExVat, vatAmount, status, recordData } = req.body;

    if (!financialType || !projectInstanceId) {
      return res.status(400).json({ error: "financialType and projectInstanceId are required" });
    }

    const result = await db.execute(sql`
      INSERT INTO finance.finance_records (
        legacy_entity_id, legacy_entity_table,
        project_instance_id, party_id,
        financial_type, direction, title,
        amount_ex_vat, vat_amount, status,
        record_data
      ) VALUES (
        0, 'api_created',
        ${projectInstanceId}, ${partyId || null},
        ${financialType}, ${direction || 'outflow'}, ${title || `${financialType} — New Record`},
        ${amountExVat || 0}::numeric, ${vatAmount || 0}::numeric, ${status || 'draft'},
        ${JSON.stringify(recordData || {})}::jsonb
      )
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[Finance] Failed to create record:", err);
    res.status(500).json({ error: "Failed to create finance record" });
  }
});

/**
 * PATCH /api/finance-records/:id
 * Update a finance record.
 */
router.patch("/api/finance-records/:id", requireAuth, checkPermission("financials", "edit"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid finance record ID" });

    const { status, title, amountExVat, vatAmount, recordData } = req.body;

    const result = await db.execute(sql`
      UPDATE finance.finance_records SET
        status = COALESCE(${status || null}, status),
        title = COALESCE(${title || null}, title),
        amount_ex_vat = CASE WHEN ${amountExVat !== undefined} THEN ${amountExVat ?? 0}::numeric ELSE amount_ex_vat END,
        vat_amount = CASE WHEN ${vatAmount !== undefined} THEN ${vatAmount ?? 0}::numeric ELSE vat_amount END,
        record_data = CASE WHEN ${recordData !== undefined} THEN ${JSON.stringify(recordData || {})}::jsonb ELSE record_data END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    if (result.rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[Finance] Failed to update record:", err);
    res.status(500).json({ error: "Failed to update finance record" });
  }
});

/**
 * GET /api/finance-records/types
 * Distinct financial types for filter dropdowns.
 */
router.get("/api/finance-records/types", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT financial_type, direction, COUNT(*)::int AS count
      FROM finance.finance_records
      GROUP BY financial_type, direction
      ORDER BY financial_type
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch finance record types" });
  }
});

export function registerFinanceRecordsV2Routes(app: import("express").Express) {
  app.use(router);
}

export default router;
