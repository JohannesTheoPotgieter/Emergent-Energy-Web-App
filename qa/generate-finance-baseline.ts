/**
 * FINANCE BASELINE SNAPSHOT GENERATOR
 *
 * Run against a live database to capture current-state numbers for
 * every finance-related read path. Output is a JSON baseline that
 * can be diffed after refactors.
 *
 * Usage: npx tsx qa/generate-finance-baseline.ts
 *
 * Output: qa/finance-baseline-snapshot.json
 */

import { db } from "../server/db";
import { sql, eq, isNull, and, count } from "drizzle-orm";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  programExpense,
  programInflows,
  purchaseOrders,
  invoiceCaptures,
  procurementItems,
  budgetBaselines,
  paymentRequests,
  paymentBatches,
  projectInfo,
} from "../shared/schema";
import * as fs from "fs";
import * as path from "path";

interface TableBaseline {
  tableName: string;
  totalRows: number;
  activeRows: number;
  closedRows: number;
  distinctProjectIds: number;
  sumAmountExVat: number | null;
  duplicateCandidates: number;
  sampleProjectBreakdown: Record<string, { rows: number; sumAmount: number }>;
}

interface ReadPathBaseline {
  pathName: string;
  description: string;
  sourceTablesUsed: string[];
  mergeLogicUsed: string;
  rowCount: number;
  sumAmount: number;
  uniqueBusinessKeys: number;
  duplicateBusinessKeys: number;
}

interface BaselineSnapshot {
  generatedAt: string;
  databaseMode: string;
  tables: TableBaseline[];
  readPaths: ReadPathBaseline[];
  crossTableComparison: {
    normalizedCostLineActiveCount: number;
    programExpenseActiveCount: number;
    overlapByProjectIdSourceRow: number;
    normalizedOnlyCount: number;
    programExpenseOnlyCount: number;
  };
  projectSamples: Record<string, {
    normalizedCostLineRows: number;
    normalizedCostLineSum: number;
    programExpenseRows: number;
    programExpenseSum: number;
    mergedWinnerCount: number | null;
    mergedWinnerSum: number | null;
  }>;
}

async function generateBaseline(): Promise<BaselineSnapshot> {
  console.log("[baseline] Starting finance baseline generation...");

  // ── Table-level counts ──
  const tables: TableBaseline[] = [];

  // normalized_cost_lines
  const nclAll = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE effective_to IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE effective_to IS NOT NULL)::int AS closed,
      COUNT(DISTINCT project_id)::int AS distinct_projects,
      COALESCE(SUM(NULLIF(amount_ex_vat, '')::numeric) FILTER (WHERE effective_to IS NULL), 0)::text AS sum_amount
    FROM normalized_cost_lines
  `);
  const nclRow = (nclAll.rows ?? nclAll)[0] as any;

  const nclDupes = await db.execute(sql`
    SELECT COUNT(*)::int AS dupes FROM (
      SELECT project_id, source_row
      FROM normalized_cost_lines
      WHERE effective_to IS NULL AND project_id IS NOT NULL AND source_row IS NOT NULL
      GROUP BY project_id, source_row
      HAVING COUNT(*) > 1
    ) sub
  `);
  const nclDupeRow = (nclDupes.rows ?? nclDupes)[0] as any;

  // Per-project breakdown for top 5 projects by row count
  const nclByProject = await db.execute(sql`
    SELECT
      pi.project_name,
      COUNT(*)::int AS rows,
      COALESCE(SUM(NULLIF(ncl.amount_ex_vat, '')::numeric), 0)::text AS sum_amount
    FROM normalized_cost_lines ncl
    JOIN project_info pi ON pi.id = ncl.project_id
    WHERE ncl.effective_to IS NULL
    GROUP BY pi.project_name
    ORDER BY COUNT(*) DESC
    LIMIT 5
  `);
  const nclProjectBreakdown: Record<string, { rows: number; sumAmount: number }> = {};
  for (const r of (nclByProject.rows ?? nclByProject) as any[]) {
    nclProjectBreakdown[r.project_name] = { rows: r.rows, sumAmount: parseFloat(r.sum_amount) || 0 };
  }

  tables.push({
    tableName: "normalized_cost_lines",
    totalRows: nclRow.total,
    activeRows: nclRow.active,
    closedRows: nclRow.closed,
    distinctProjectIds: nclRow.distinct_projects,
    sumAmountExVat: parseFloat(nclRow.sum_amount) || 0,
    duplicateCandidates: nclDupeRow.dupes,
    sampleProjectBreakdown: nclProjectBreakdown,
  });

  // program_expense
  const peAll = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE effective_to IS NULL AND deleted_at IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE effective_to IS NOT NULL OR deleted_at IS NOT NULL)::int AS closed,
      COUNT(DISTINCT project_id)::int AS distinct_projects,
      COALESCE(SUM(NULLIF(expense_actual_total, '')::numeric) FILTER (WHERE effective_to IS NULL AND deleted_at IS NULL), 0)::text AS sum_amount
    FROM program_expense
  `);
  const peRow = (peAll.rows ?? peAll)[0] as any;

  const peDupes = await db.execute(sql`
    SELECT COUNT(*)::int AS dupes FROM (
      SELECT project_id, row_number
      FROM program_expense
      WHERE effective_to IS NULL AND deleted_at IS NULL AND project_id IS NOT NULL AND row_number IS NOT NULL
      GROUP BY project_id, row_number
      HAVING COUNT(*) > 1
    ) sub
  `);
  const peDupeRow = (peDupes.rows ?? peDupes)[0] as any;

  const peByProject = await db.execute(sql`
    SELECT
      pi.project_name,
      COUNT(*)::int AS rows,
      COALESCE(SUM(NULLIF(pe.expense_actual_total, '')::numeric), 0)::text AS sum_amount
    FROM program_expense pe
    JOIN project_info pi ON pi.id = pe.project_id
    WHERE pe.effective_to IS NULL AND pe.deleted_at IS NULL
    GROUP BY pi.project_name
    ORDER BY COUNT(*) DESC
    LIMIT 5
  `);
  const peProjectBreakdown: Record<string, { rows: number; sumAmount: number }> = {};
  for (const r of (peByProject.rows ?? peByProject) as any[]) {
    peProjectBreakdown[r.project_name] = { rows: r.rows, sumAmount: parseFloat(r.sum_amount) || 0 };
  }

  tables.push({
    tableName: "program_expense",
    totalRows: peRow.total,
    activeRows: peRow.active,
    closedRows: peRow.closed,
    distinctProjectIds: peRow.distinct_projects,
    sumAmountExVat: parseFloat(peRow.sum_amount) || 0,
    duplicateCandidates: peDupeRow.dupes,
    sampleProjectBreakdown: peProjectBreakdown,
  });

  // normalized_revenue_lines
  const nrlAll = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE effective_to IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE effective_to IS NOT NULL)::int AS closed,
      COUNT(DISTINCT project_id)::int AS distinct_projects,
      COALESCE(SUM(NULLIF(amount_ex_vat, '')::numeric) FILTER (WHERE effective_to IS NULL), 0)::text AS sum_amount
    FROM normalized_revenue_lines
  `);
  const nrlRow = (nrlAll.rows ?? nrlAll)[0] as any;
  tables.push({
    tableName: "normalized_revenue_lines",
    totalRows: nrlRow.total,
    activeRows: nrlRow.active,
    closedRows: nrlRow.closed,
    distinctProjectIds: nrlRow.distinct_projects,
    sumAmountExVat: parseFloat(nrlRow.sum_amount) || 0,
    duplicateCandidates: 0,
    sampleProjectBreakdown: {},
  });

  // program_inflows
  const piAll = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE effective_to IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE effective_to IS NOT NULL)::int AS closed,
      COUNT(DISTINCT project_id)::int AS distinct_projects,
      COALESCE(SUM(NULLIF(milestone_amount, '')::numeric) FILTER (WHERE effective_to IS NULL), 0)::text AS sum_amount
    FROM program_inflows
  `);
  const piRow = (piAll.rows ?? piAll)[0] as any;
  tables.push({
    tableName: "program_inflows",
    totalRows: piRow.total,
    activeRows: piRow.active,
    closedRows: piRow.closed,
    distinctProjectIds: piRow.distinct_projects,
    sumAmountExVat: parseFloat(piRow.sum_amount) || 0,
    duplicateCandidates: 0,
    sampleProjectBreakdown: {},
  });

  // purchase_orders
  const poAll = await db.execute(sql`
    SELECT COUNT(*)::int AS total, COALESCE(SUM(total::numeric), 0)::text AS sum_amount
    FROM purchase_orders
  `);
  const poRow = (poAll.rows ?? poAll)[0] as any;
  tables.push({
    tableName: "purchase_orders",
    totalRows: poRow.total,
    activeRows: poRow.total,
    closedRows: 0,
    distinctProjectIds: 0,
    sumAmountExVat: parseFloat(poRow.sum_amount) || 0,
    duplicateCandidates: 0,
    sampleProjectBreakdown: {},
  });

  // ── Cross-table comparison (the critical overlap check) ──
  const overlapResult = await db.execute(sql`
    WITH ncl_active AS (
      SELECT project_id, source_row
      FROM normalized_cost_lines
      WHERE effective_to IS NULL AND project_id IS NOT NULL AND source_row IS NOT NULL
    ),
    pe_active AS (
      SELECT project_id, row_number AS source_row
      FROM program_expense
      WHERE effective_to IS NULL AND deleted_at IS NULL AND project_id IS NOT NULL AND row_number IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM ncl_active)::int AS ncl_count,
      (SELECT COUNT(*) FROM pe_active)::int AS pe_count,
      (SELECT COUNT(*) FROM ncl_active n INNER JOIN pe_active p ON n.project_id = p.project_id AND n.source_row = p.source_row)::int AS overlap,
      (SELECT COUNT(*) FROM ncl_active n LEFT JOIN pe_active p ON n.project_id = p.project_id AND n.source_row = p.source_row WHERE p.source_row IS NULL)::int AS ncl_only,
      (SELECT COUNT(*) FROM pe_active p LEFT JOIN ncl_active n ON n.project_id = p.project_id AND n.source_row = p.source_row WHERE n.source_row IS NULL)::int AS pe_only
  `);
  const overlap = (overlapResult.rows ?? overlapResult)[0] as any;

  // ── Per-project sample: first 3 projects with both NCL and PE data ──
  const sampleProjects = await db.execute(sql`
    SELECT DISTINCT pi.project_name, pi.id AS project_id
    FROM project_info pi
    WHERE EXISTS (SELECT 1 FROM normalized_cost_lines ncl WHERE ncl.project_id = pi.id AND ncl.effective_to IS NULL)
      AND EXISTS (SELECT 1 FROM program_expense pe WHERE pe.project_id = pi.id AND pe.effective_to IS NULL AND pe.deleted_at IS NULL)
    ORDER BY pi.project_name
    LIMIT 3
  `);

  const projectSamples: Record<string, any> = {};
  for (const p of (sampleProjects.rows ?? sampleProjects) as any[]) {
    const nclSample = await db.execute(sql`
      SELECT COUNT(*)::int AS rows, COALESCE(SUM(NULLIF(amount_ex_vat, '')::numeric), 0)::text AS sum_amount
      FROM normalized_cost_lines
      WHERE project_id = ${p.project_id} AND effective_to IS NULL
    `);
    const peSample = await db.execute(sql`
      SELECT COUNT(*)::int AS rows, COALESCE(SUM(NULLIF(expense_actual_total, '')::numeric), 0)::text AS sum_amount
      FROM program_expense
      WHERE project_id = ${p.project_id} AND effective_to IS NULL AND deleted_at IS NULL
    `);
    const nclR = (nclSample.rows ?? nclSample)[0] as any;
    const peR = (peSample.rows ?? peSample)[0] as any;

    projectSamples[p.project_name] = {
      normalizedCostLineRows: nclR.rows,
      normalizedCostLineSum: parseFloat(nclR.sum_amount) || 0,
      programExpenseRows: peR.rows,
      programExpenseSum: parseFloat(peR.sum_amount) || 0,
      mergedWinnerCount: null,
      mergedWinnerSum: null,
    };
  }

  // ── Promoted schema check ──
  let promotedCostLineCount = 0;
  let promotedCostLineSum = 0;
  try {
    const promotedResult = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(NULLIF(amount_ex_vat, '')::numeric), 0)::text AS sum_amount
      FROM finance.cost_lines
      WHERE soft_deleted_at IS NULL
    `);
    const pr = (promotedResult.rows ?? promotedResult)[0] as any;
    promotedCostLineCount = pr.total;
    promotedCostLineSum = parseFloat(pr.sum_amount) || 0;
  } catch {
    console.log("[baseline] finance.cost_lines not available (schema may not exist)");
  }

  tables.push({
    tableName: "finance.cost_lines (promoted)",
    totalRows: promotedCostLineCount,
    activeRows: promotedCostLineCount,
    closedRows: 0,
    distinctProjectIds: 0,
    sumAmountExVat: promotedCostLineSum,
    duplicateCandidates: 0,
    sampleProjectBreakdown: {},
  });

  // ── Build read-path baselines (structural, not live API) ──
  const readPaths: ReadPathBaseline[] = [
    {
      pathName: "ExpenditureTab (read-only)",
      description: "GET /api/program-expenses?projectName=X → storage.getProgramExpensesByProject()",
      sourceTablesUsed: ["normalized_cost_lines", "program_expense", "finance.cost_lines (promoted fallback)"],
      mergeLogicUsed: "adaptCostToExpense + selectWinningExpenseRows (business key dedup)",
      rowCount: -1,
      sumAmount: -1,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: -1,
    },
    {
      pathName: "ExpenditureEditableTab",
      description: "GET /api/expenditure-breakdown/:projectName → storage.getProgramExpensesByProject()",
      sourceTablesUsed: ["normalized_cost_lines", "program_expense", "finance.cost_lines (promoted fallback)"],
      mergeLogicUsed: "adaptCostToExpense + selectWinningExpenseRows (business key dedup)",
      rowCount: -1,
      sumAmount: -1,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: -1,
    },
    {
      pathName: "COS Tracker",
      description: "GET /api/cos-tracker → storage.getAllProgramExpenses()",
      sourceTablesUsed: ["normalized_cost_lines", "program_expense", "finance.cost_lines (promoted fallback)"],
      mergeLogicUsed: "adaptCostToExpense + selectWinningExpenseRows (business key dedup)",
      rowCount: -1,
      sumAmount: -1,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: -1,
    },
    {
      pathName: "Cashflow Page",
      description: "GET /api/cashflow-2026 → storage.getAllProgramExpenses()",
      sourceTablesUsed: ["normalized_cost_lines", "program_expense", "finance.cost_lines (promoted fallback)"],
      mergeLogicUsed: "adaptCostToExpense + selectWinningExpenseRows (business key dedup)",
      rowCount: -1,
      sumAmount: -1,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: -1,
    },
    {
      pathName: "Execution Dashboard (FinancePage)",
      description: "GET /api/lifecycle-board/execution-dashboard → direct normalizedCostLines query",
      sourceTablesUsed: ["normalized_cost_lines"],
      mergeLogicUsed: "NONE — direct query, no merge with program_expense",
      rowCount: nclRow.active,
      sumAmount: parseFloat(nclRow.sum_amount) || 0,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: nclDupeRow.dupes,
    },
    {
      pathName: "Company Overview",
      description: "GET /api/company-overview → company-overview-service.ts → direct normalizedCostLines query",
      sourceTablesUsed: ["normalized_cost_lines"],
      mergeLogicUsed: "NONE — direct query, no merge with program_expense",
      rowCount: nclRow.active,
      sumAmount: parseFloat(nclRow.sum_amount) || 0,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: nclDupeRow.dupes,
    },
    {
      pathName: "Dashboard Metrics",
      description: "Materialized → dashboard-metrics.ts → direct normalizedCostLines per project",
      sourceTablesUsed: ["normalized_cost_lines"],
      mergeLogicUsed: "NONE — direct query, no merge with program_expense",
      rowCount: nclRow.active,
      sumAmount: parseFloat(nclRow.sum_amount) || 0,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: nclDupeRow.dupes,
    },
    {
      pathName: "Project Header KPIs",
      description: "GET /project-header-kpis/:id → project-header-kpi-service.ts → direct normalizedCostLines per project",
      sourceTablesUsed: ["normalized_cost_lines"],
      mergeLogicUsed: "NONE — direct query, no merge with program_expense",
      rowCount: nclRow.active,
      sumAmount: parseFloat(nclRow.sum_amount) || 0,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: nclDupeRow.dupes,
    },
    {
      pathName: "Finance Workspace (Summary)",
      description: "GET /api/projects/:id/finance-summary → finance-records-v2.routes.ts → finance.finance_records (promoted)",
      sourceTablesUsed: ["finance.finance_records (promoted schema)"],
      mergeLogicUsed: "NONE — reads promoted schema only, completely different source",
      rowCount: -1,
      sumAmount: -1,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: -1,
    },
    {
      pathName: "Revenue Tracker",
      description: "GET /api/revenue-tracker → finance-routes.ts → storage.getAllProgramInflows() (merged path)",
      sourceTablesUsed: ["normalized_revenue_lines", "program_inflows"],
      mergeLogicUsed: "Inflow merge similar to expense merge",
      rowCount: -1,
      sumAmount: -1,
      uniqueBusinessKeys: -1,
      duplicateBusinessKeys: -1,
    },
  ];

  const snapshot: BaselineSnapshot = {
    generatedAt: new Date().toISOString(),
    databaseMode: process.env.DATABASE_URL ? "postgres" : "unknown",
    tables,
    readPaths,
    crossTableComparison: {
      normalizedCostLineActiveCount: overlap.ncl_count,
      programExpenseActiveCount: overlap.pe_count,
      overlapByProjectIdSourceRow: overlap.overlap,
      normalizedOnlyCount: overlap.ncl_only,
      programExpenseOnlyCount: overlap.pe_only,
    },
    projectSamples,
  };

  return snapshot;
}

async function main() {
  try {
    const snapshot = await generateBaseline();
    const outPath = path.resolve(__dirname, "finance-baseline-snapshot.json");
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.log(`[baseline] Snapshot written to ${outPath}`);

    // Print summary
    console.log("\n=== FINANCE BASELINE SUMMARY ===\n");
    for (const t of snapshot.tables) {
      console.log(`  ${t.tableName}: ${t.activeRows} active rows, sum=${t.sumAmountExVat}, dupes=${t.duplicateCandidates}`);
    }
    console.log(`\n  Cross-table overlap:`);
    console.log(`    NCL active: ${snapshot.crossTableComparison.normalizedCostLineActiveCount}`);
    console.log(`    PE active:  ${snapshot.crossTableComparison.programExpenseActiveCount}`);
    console.log(`    Overlap (projectId+sourceRow): ${snapshot.crossTableComparison.overlapByProjectIdSourceRow}`);
    console.log(`    NCL-only: ${snapshot.crossTableComparison.normalizedOnlyCount}`);
    console.log(`    PE-only:  ${snapshot.crossTableComparison.programExpenseOnlyCount}`);

    if (Object.keys(snapshot.projectSamples).length > 0) {
      console.log(`\n  Sample projects:`);
      for (const [name, data] of Object.entries(snapshot.projectSamples)) {
        console.log(`    ${name}:`);
        console.log(`      NCL: ${data.normalizedCostLineRows} rows, sum=${data.normalizedCostLineSum}`);
        console.log(`      PE:  ${data.programExpenseRows} rows, sum=${data.programExpenseSum}`);
      }
    }

    console.log("\n=== END ===\n");
    process.exit(0);
  } catch (err) {
    console.error("[baseline] Failed:", err);
    process.exit(1);
  }
}

main();
