/**
 * FYE Revenue Tracking API Routes
 *
 * Provides endpoints for the FYE Revenue Tracking report:
 * - Dashboard data (monthly Revenue/COS/GP with budget, actual, forecast)
 * - FYE Detail (project-level budget vs actual)
 * - Forecast Pipeline CRUD
 * - Lost Deals CRUD
 * - KPI counts
 *
 * Field-to-source mapping:
 * ─────────────────────────────────────────────────────────────────
 * DASHBOARD:
 *   Budget Revenue (monthly)   → fye_budgets (budgetType="revenue") [editable by finance]
 *   Budget COS (monthly)       → fye_budgets (budgetType="cos") [editable by finance]
 *   Actual Revenue (monthly)   → program_inflows (milestoneAmount, keyed by paymentReceivedDate) [read-only import]
 *   Actual COS (monthly)       → program_expense (actualCosTotal/expenseActualTotal, keyed by expenseInvoicedDate) [read-only import]
 *   Captured Revenue           → finance_revenue_monthly (value, summed per monthEndDate) [read-only import]
 *   Captured COS               → finance_cos_monthly (value, summed per monthEndDate) [read-only import]
 *   Forecast Revenue           → fye_budgets for future months (budget as forecast proxy)
 *   GP                         → Revenue - COS (derived)
 *
 * FYE DETAIL:
 *   Project Name               → project_info.projectName [read-only]
 *   Business Developer         → project_info.pd (project developer) [read-only]
 *   Province                   → pd_tickets.province / intake_requests.province [read-only]
 *   Size (kWp)                 → project_info.sizeKwp [read-only]
 *   Project Type               → project_editable_fields.costProposalType [read-only]
 *   Funding Type               → project_editable_fields.fundingType [read-only]
 *   Start Date                 → project_info.constructionStartDate [read-only]
 *   PC Date                    → project_info.commissioningDate [read-only]
 *   Status                     → project_info.phase [read-only]
 *   Budget Revenue             → project_revenue_summary.plannedRevenue [read-only import]
 *   Budget COS                 → project_revenue_summary.plannedExpenditure [read-only import]
 *   Actual Revenue             → project_revenue_summary.actualRevenue [read-only import]
 *   Actual Expense             → project_revenue_summary.actualExpenditure [read-only import]
 *
 * FORECAST PIPELINE:
 *   All fields                 → forecast_pipeline table [editable by finance/commercial roles]
 *
 * LOST DEALS:
 *   All fields                 → lost_deals table [editable by finance/commercial roles]
 *
 * KPI COUNTS:
 *   Brought In                 → project_info where phase in active development phases
 *   Signed                     → project_info where signedStatus = 'SIGNED'
 *   Total                      → Brought In + Signed
 * ─────────────────────────────────────────────────────────────────
 */

import { Router, type Express } from "express";
import { requireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { db } from "../db";
import { z } from "zod";
import {
  projectInfo,
  projectRevenueSummary,
  projectEditableFields,
  programInflows,
  programExpense,
  financeRevenueMonthly,
  financeCosMonthly,
  fyeBudgets,
  forecastPipeline,
  lostDeals,
  pdTickets,
  fyeKpiCounters,
  fyeReportSnapshots,
} from "@shared/schema";
import { eq, and, sql, gte, lte, desc, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { extractMonthKey, parseExpenseAmount } from "../lib/calculations/financeUtils";

const router = Router();

// ─── Helpers ───

/** Generate the 12 month keys for a given FYE (Sep of FYE-1 to Aug of FYE). */
function getFyeMonthKeys(fye: number): string[] {
  const months: string[] = [];
  for (let m = 9; m <= 12; m++) {
    months.push(`${fye - 1}-${String(m).padStart(2, "0")}`);
  }
  for (let m = 1; m <= 8; m++) {
    months.push(`${fye}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

/** Get current active FYE: if we're in Sep-Dec, FYE = currentYear+1; else FYE = currentYear. */
function getCurrentFye(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

/** Get month label like "Sep 25" from "2025-09". */
function monthKeyToLabel(mk: string): string {
  const [y, m] = mk.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

/** Safe divide, returns null on division by zero. */
function safeDivide(num: number, den: number): number | null {
  if (den === 0 || !isFinite(den)) return null;
  return num / den;
}

/** Safe parse float. */
function safeNum(v: any): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

// ─── GET /api/fye-revenue-tracking/dashboard ───
router.get(
  "/api/fye-revenue-tracking/dashboard",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = parseInt(String(req.query.fye || getCurrentFye()), 10);
      const monthKeys = getFyeMonthKeys(fye);

      // 1. Budget data from fye_budgets (may be empty if not yet entered)
      const budgetRevByMonth: Record<string, number> = {};
      const budgetCosByMonth: Record<string, number> = {};
      try {
        const budgetRows = await db
          .select({ monthKey: fyeBudgets.monthKey, budgetType: fyeBudgets.budgetType, amount: fyeBudgets.amount })
          .from(fyeBudgets)
          .where(eq(fyeBudgets.fye, String(fye)));

        for (const b of budgetRows) {
          const amt = safeNum(b.amount);
          if (b.budgetType === "revenue") {
            budgetRevByMonth[b.monthKey] = (budgetRevByMonth[b.monthKey] || 0) + amt;
          } else if (b.budgetType === "cos") {
            budgetCosByMonth[b.monthKey] = (budgetCosByMonth[b.monthKey] || 0) + amt;
          }
        }
      } catch {
        // fye_budgets table may not exist yet
      }

      // 2. Actual Revenue from program_inflows (payment received dates within FYE)
      const allInflows = await db.select({
        projectName: programInflows.projectName,
        milestoneAmount: programInflows.milestoneAmount,
        paymentReceivedDate: programInflows.paymentReceivedDate,
      }).from(programInflows);
      const actualRevByMonth: Record<string, number> = {};
      for (const inf of allInflows) {
        // Only count as actual if payment was actually received
        if (!inf.paymentReceivedDate) continue;
        const mk = extractMonthKey(inf.paymentReceivedDate);
        if (mk && monthKeys.includes(mk)) {
          const amt = safeNum(inf.milestoneAmount);
          actualRevByMonth[mk] = (actualRevByMonth[mk] || 0) + amt;
        }
      }

      // 3. Actual COS from program_expense (invoice dates within FYE)
      const allExpenses = await db.select({
        projectName: programExpense.projectName,
        rowType: programExpense.rowType,
        expenseActualTotal: programExpense.expenseActualTotal,
        actualCosTotal: programExpense.actualCosTotal,
        expenseInvoicedDate: programExpense.expenseInvoicedDate,
      }).from(programExpense);
      const actualCosByMonth: Record<string, number> = {};
      for (const exp of allExpenses) {
        // Skip non-item rows (categories, subtotals, blanks).
        // If rowType is null/undefined (SQLite may not have the column), treat as item.
        if (exp.rowType != null && exp.rowType !== "item") continue;
        const mk = extractMonthKey(exp.expenseInvoicedDate);
        if (mk && monthKeys.includes(mk)) {
          const amt = safeNum(exp.actualCosTotal || exp.expenseActualTotal);
          if (amt !== 0) {
            actualCosByMonth[mk] = (actualCosByMonth[mk] || 0) + amt;
          }
        }
      }

      // 4. Captured data from finance_revenue_monthly / finance_cos_monthly
      const capturedRevRows = await db.select({
        monthEndDate: financeRevenueMonthly.monthEndDate,
        value: financeRevenueMonthly.value,
      }).from(financeRevenueMonthly);
      const capturedRevByMonth: Record<string, number> = {};
      for (const r of capturedRevRows) {
        const mk = extractMonthKey(r.monthEndDate);
        if (mk && monthKeys.includes(mk)) {
          capturedRevByMonth[mk] = (capturedRevByMonth[mk] || 0) + safeNum(r.value);
        }
      }

      const capturedCosRows = await db.select({
        monthEndDate: financeCosMonthly.monthEndDate,
        value: financeCosMonthly.value,
      }).from(financeCosMonthly);
      const capturedCosByMonth: Record<string, number> = {};
      for (const r of capturedCosRows) {
        const mk = extractMonthKey(r.monthEndDate);
        if (mk && monthKeys.includes(mk)) {
          capturedCosByMonth[mk] = (capturedCosByMonth[mk] || 0) + safeNum(r.value);
        }
      }

      // Determine current month key for actual vs forecast split
      const now = new Date();
      const currentMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      // Build monthly dashboard data
      const months = monthKeys.map((mk) => {
        const budgetRev = budgetRevByMonth[mk] || 0;
        const budgetCos = budgetCosByMonth[mk] || 0;
        const isPastOrCurrent = mk <= currentMk;

        // Actual values - only for past/current months, null for future
        const actualRev = isPastOrCurrent ? (actualRevByMonth[mk] || 0) : null;
        const actualCos = isPastOrCurrent ? (actualCosByMonth[mk] || 0) : null;

        // Captured data
        const capturedRev = capturedRevByMonth[mk] || null;
        const capturedCos = capturedCosByMonth[mk] || null;

        // Actual + Forecast: use actual for past months, budget for future
        const actualForecastRev = isPastOrCurrent ? (actualRevByMonth[mk] || 0) : budgetRev;
        const actualForecastCos = isPastOrCurrent ? (actualCosByMonth[mk] || 0) : budgetCos;

        return {
          monthKey: mk,
          label: monthKeyToLabel(mk),
          revenue: {
            budget: budgetRev,
            actualForecast: actualForecastRev,
            actual: actualRev,
            captured: capturedRev !== null ? capturedRev : (isPastOrCurrent ? 0 : null),
          },
          cos: {
            budget: budgetCos,
            actualForecast: actualForecastCos,
            actual: actualCos,
            captured: capturedCos !== null ? capturedCos : (isPastOrCurrent ? 0 : null),
          },
          gp: {
            budget: budgetRev - budgetCos,
            actualForecast: actualForecastRev - actualForecastCos,
            actual: actualRev !== null && actualCos !== null ? actualRev - actualCos : null,
            captured:
              capturedRev !== null && capturedCos !== null
                ? capturedRev - capturedCos
                : isPastOrCurrent ? 0 : null,
          },
        };
      });

      res.json({ fye, months, monthKeys });
    } catch (error: any) {
      console.error("FYE dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch FYE dashboard", message: error?.message });
    }
  }
);

// ─── GET /api/fye-revenue-tracking/detail ───
router.get(
  "/api/fye-revenue-tracking/detail",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = parseInt(String(req.query.fye || getCurrentFye()), 10);
      const monthKeys = getFyeMonthKeys(fye);
      const fyeStart = `${fye - 1}-09`;
      const fyeEnd = `${fye}-08`;

      // Get all projects (isActive may not exist in SQLite — treat null as true)
      const projects = await db
        .select({
          id: projectInfo.id,
          projectName: projectInfo.projectName,
          sizeKwp: projectInfo.sizeKwp,
          pd: projectInfo.pd,
          constructionStartDate: projectInfo.constructionStartDate,
          commissioningDate: projectInfo.commissioningDate,
          phase: projectInfo.phase,
          signedStatus: projectInfo.signedStatus,
          isActive: projectInfo.isActive,
          contractValue: projectInfo.contractValue,
        })
        .from(projectInfo);

      // Filter: isActive may be undefined in SQLite (column missing) — treat as true
      const activeProjects = projects.filter((p) => p.isActive !== false);

      // Try project_revenue_summary first (Postgres), fall back to computing from raw data
      let revSummaryMap = new Map<string, any>();
      try {
        const revSummaries = await db.select({
          projectName: projectRevenueSummary.projectName,
          plannedRevenue: projectRevenueSummary.plannedRevenue,
          plannedExpenditure: projectRevenueSummary.plannedExpenditure,
          actualRevenue: projectRevenueSummary.actualRevenue,
          actualExpenditure: projectRevenueSummary.actualExpenditure,
        }).from(projectRevenueSummary);
        if (revSummaries.length > 0) {
          revSummaryMap = new Map(revSummaries.map((r) => [r.projectName, r]));
        }
      } catch {
        // Table may not exist in SQLite — proceed with computed values
      }

      // If project_revenue_summary is empty, compute from raw data
      if (revSummaryMap.size === 0) {
        // Budget Revenue per project = SUM(milestone_amount) from all inflows
        const allInflows = await db.select({
          projectName: programInflows.projectName,
          milestoneAmount: programInflows.milestoneAmount,
          paymentReceivedDate: programInflows.paymentReceivedDate,
        }).from(programInflows);
        // Actual Revenue per project = SUM(milestone_amount) WHERE payment_received_date within FYE
        const inflowsByProject = new Map<string, { budget: number; actual: number }>();
        for (const inf of allInflows) {
          const pn = inf.projectName;
          if (!inflowsByProject.has(pn)) inflowsByProject.set(pn, { budget: 0, actual: 0 });
          const entry = inflowsByProject.get(pn)!;
          entry.budget += safeNum(inf.milestoneAmount);
          if (inf.paymentReceivedDate) {
            const mk = extractMonthKey(inf.paymentReceivedDate);
            if (mk && mk >= fyeStart && mk <= fyeEnd) {
              entry.actual += safeNum(inf.milestoneAmount);
            }
          }
        }

        // Budget COS per project = SUM(expense_actual_total) from all expenses
        // Actual COS per project = SUM(expense_actual_total) WHERE invoiced within FYE
        const allExpenses = await db.select({
          projectName: programExpense.projectName,
          rowType: programExpense.rowType,
          expenseActualTotal: programExpense.expenseActualTotal,
          actualCosTotal: programExpense.actualCosTotal,
          expenseInvoicedDate: programExpense.expenseInvoicedDate,
        }).from(programExpense);
        const expensesByProject = new Map<string, { budget: number; actual: number }>();
        for (const exp of allExpenses) {
          // Skip non-item rows if rowType exists
          if (exp.rowType != null && exp.rowType !== "item") continue;
          const pn = exp.projectName;
          if (!expensesByProject.has(pn)) expensesByProject.set(pn, { budget: 0, actual: 0 });
          const entry = expensesByProject.get(pn)!;
          const amt = safeNum(exp.actualCosTotal || exp.expenseActualTotal);
          entry.budget += amt;
          if (exp.expenseInvoicedDate) {
            const mk = extractMonthKey(exp.expenseInvoicedDate);
            if (mk && mk >= fyeStart && mk <= fyeEnd) {
              entry.actual += amt;
            }
          }
        }

        for (const p of activeProjects) {
          const inf = inflowsByProject.get(p.projectName) || { budget: 0, actual: 0 };
          const exp = expensesByProject.get(p.projectName) || { budget: 0, actual: 0 };
          revSummaryMap.set(p.projectName, {
            plannedRevenue: inf.budget,
            plannedExpenditure: exp.budget,
            actualRevenue: inf.actual,
            actualExpenditure: exp.actual,
          });
        }
      }

      // Editable fields (for project type, funding type)
      let editableMap = new Map<string, any>();
      try {
        const editableFields = await db.select({
          projectName: projectEditableFields.projectName,
          costProposalType: projectEditableFields.costProposalType,
          fundingType: projectEditableFields.fundingType,
        }).from(projectEditableFields);
        editableMap = new Map(editableFields.map((e) => [e.projectName, e]));
      } catch {
        // Table may have schema mismatch
      }

      // PD tickets for province (use latest per project)
      let provinceMap = new Map<string, string>();
      try {
        const tickets = await db.select({
          projectSiteName: pdTickets.projectSiteName,
          province: pdTickets.province,
        }).from(pdTickets);
        for (const t of tickets) {
          if (t.province && t.projectSiteName) {
            provinceMap.set(t.projectSiteName, t.province);
          }
        }
      } catch {
        // pd_tickets may not exist in older SQLite schemas
      }

      const projectRows = activeProjects.map((p) => {
        const summary = revSummaryMap.get(p.projectName) as any;
        const editable = editableMap.get(p.projectName) as any;
        const budgetRev = safeNum(summary?.plannedRevenue);
        const budgetCos = safeNum(summary?.plannedExpenditure);
        const actualRev = safeNum(summary?.actualRevenue);
        const actualExp = safeNum(summary?.actualExpenditure);
        const budgetGp = budgetRev - budgetCos;
        const actualGp = actualRev - actualExp;

        return {
          projectId: p.id,
          projectName: p.projectName,
          businessDeveloper: p.pd || null,
          province: provinceMap.get(p.projectName) || null,
          sizeKwp: safeNum(p.sizeKwp),
          projectType: editable?.costProposalType || null,
          fundingType: editable?.fundingType || null,
          startDate: p.constructionStartDate || null,
          pcDate: p.commissioningDate || null,
          status: p.phase || null,
          budgetRevenue: budgetRev,
          budgetCos: budgetCos,
          budgetGp,
          actualRevenue: actualRev,
          actualExpense: actualExp,
          actualGp,
          budgetGpPct: safeDivide(budgetGp, budgetRev),
          actualGpPct: safeDivide(actualGp, actualRev),
          signedStatus: p.signedStatus || "NONE",
        };
      });

      // Summary totals
      const totals = projectRows.reduce(
        (acc, r) => {
          acc.budgetRevenue += r.budgetRevenue;
          acc.budgetCos += r.budgetCos;
          acc.budgetGp += r.budgetGp;
          acc.actualRevenue += r.actualRevenue;
          acc.actualExpense += r.actualExpense;
          acc.actualGp += r.actualGp;
          return acc;
        },
        { budgetRevenue: 0, budgetCos: 0, budgetGp: 0, actualRevenue: 0, actualExpense: 0, actualGp: 0 }
      );

      res.json({
        fye,
        projects: projectRows,
        totals: {
          ...totals,
          budgetGpPct: safeDivide(totals.budgetGp, totals.budgetRevenue),
          actualGpPct: safeDivide(totals.actualGp, totals.actualRevenue),
        },
      });
    } catch (error: any) {
      console.error("FYE detail error:", error);
      res.status(500).json({ error: "Failed to fetch FYE detail", message: error?.message });
    }
  }
);

// ─── GET /api/fye-revenue-tracking/budgets ───
router.get(
  "/api/fye-revenue-tracking/budgets",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = String(req.query.fye || getCurrentFye());
      const rows = await db.select({
        id: fyeBudgets.id, projectName: fyeBudgets.projectName, fye: fyeBudgets.fye,
        monthKey: fyeBudgets.monthKey, budgetType: fyeBudgets.budgetType, amount: fyeBudgets.amount,
      }).from(fyeBudgets).where(eq(fyeBudgets.fye, fye));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch budgets", message: error?.message });
    }
  }
);

// ─── POST /api/fye-revenue-tracking/budgets ───
router.post(
  "/api/fye-revenue-tracking/budgets",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const schema = z.object({
        projectName: z.string(),
        fye: z.string(),
        monthKey: z.string(),
        budgetType: z.enum(["revenue", "cos"]),
        amount: z.string().or(z.number()),
      });
      const data = schema.parse(req.body);
      const userId = (req as any).user?.id;

      // Upsert
      const existing = await db
        .select({ id: fyeBudgets.id })
        .from(fyeBudgets)
        .where(
          and(
            eq(fyeBudgets.projectName, data.projectName),
            eq(fyeBudgets.fye, data.fye),
            eq(fyeBudgets.monthKey, data.monthKey),
            eq(fyeBudgets.budgetType, data.budgetType)
          )
        );

      if (existing.length > 0) {
        await db
          .update(fyeBudgets)
          .set({ amount: String(data.amount), updatedBy: userId, updatedAt: new Date() })
          .where(eq(fyeBudgets.id, existing[0].id));
      } else {
        // Lookup project ID
        const [proj] = await db
          .select({ id: projectInfo.id })
          .from(projectInfo)
          .where(eq(projectInfo.projectName, data.projectName))
          .limit(1);

        await db.execute(sql`INSERT INTO fye_budgets (project_id, project_name, fye, month_key, budget_type, amount, updated_by, created_at, updated_at)
          VALUES (${proj?.id || null}, ${data.projectName}, ${data.fye}, ${data.monthKey}, ${data.budgetType}, ${String(data.amount)}, ${userId || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to save budget", message: error?.message });
    }
  }
);

// ─── Forecast Pipeline CRUD ───
router.get(
  "/api/fye-revenue-tracking/pipeline",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = parseInt(String(req.query.fye || getCurrentFye()), 10);
      const rows = await db
        .select({
          id: forecastPipeline.id,
          fyeYear: forecastPipeline.fyeYear,
          projectName: forecastPipeline.projectName,
          projectDeveloper: forecastPipeline.projectDeveloper,
          location: forecastPipeline.location,
          sizeKwp: forecastPipeline.sizeKwp,
          dealProbabilityPct: forecastPipeline.dealProbabilityPct,
          forecastSignatureDate: forecastPipeline.forecastSignatureDate,
          solarRevenue: forecastPipeline.solarRevenue,
          bessRevenue: forecastPipeline.bessRevenue,
          forecastGpPct: forecastPipeline.forecastGpPct,
          status: forecastPipeline.status,
          notes: forecastPipeline.notes,
          updatedAt: forecastPipeline.updatedAt,
        })
        .from(forecastPipeline)
        .where(and(eq(forecastPipeline.status, "active"), eq(forecastPipeline.fyeYear, fye)))
        .orderBy(desc(forecastPipeline.updatedAt));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch pipeline", message: error?.message });
    }
  }
);

router.post(
  "/api/fye-revenue-tracking/pipeline",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const pipelineSchema = z.object({
        fyeYear: z.number().optional(),
        projectName: z.string().min(1),
        projectDeveloper: z.string().optional(),
        location: z.string().optional(),
        sizeKwp: z.string().or(z.number()).optional(),
        dealProbabilityPct: z.number().min(0).max(100),
        forecastSignatureDate: z.string().optional(),
        solarRevenue: z.string().or(z.number()).optional(),
        bessRevenue: z.string().or(z.number()).optional(),
        forecastGpPct: z.string().or(z.number()).nullable().optional(),
        notes: z.string().optional(),
      });
      const data = pipelineSchema.parse(req.body);
      const userId = (req as any).user?.id;

      await db.execute(sql`INSERT INTO forecast_pipeline (fye_year, project_name, project_developer, location, size_kwp, deal_probability_pct, forecast_signature_date, solar_revenue, bess_revenue, forecast_gp_pct, notes, status, created_by, updated_by, created_at, updated_at)
        VALUES (${data.fyeYear || getCurrentFye()}, ${data.projectName}, ${data.projectDeveloper || null}, ${data.location || null}, ${data.sizeKwp != null ? String(data.sizeKwp) : null}, ${data.dealProbabilityPct}, ${data.forecastSignatureDate || null}, ${data.solarRevenue != null ? String(data.solarRevenue) : "0"}, ${data.bessRevenue != null ? String(data.bessRevenue) : "0"}, ${data.forecastGpPct != null ? String(data.forecastGpPct) : null}, ${data.notes || null}, 'active', ${userId || null}, ${userId || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);

      const [row] = await db.select({ id: forecastPipeline.id, projectName: forecastPipeline.projectName }).from(forecastPipeline).orderBy(desc(forecastPipeline.id)).limit(1);
      res.json(row);
    } catch (error: any) {
      res.status(400).json({ error: "Failed to create pipeline entry", message: error?.message });
    }
  }
);

router.put(
  "/api/fye-revenue-tracking/pipeline/:id",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const userId = (req as any).user?.id;
      const data = req.body;

      await db
        .update(forecastPipeline)
        .set({
          ...data,
          sizeKwp: data.sizeKwp != null ? String(data.sizeKwp) : undefined,
          solarRevenue: data.solarRevenue != null ? String(data.solarRevenue) : undefined,
          bessRevenue: data.bessRevenue != null ? String(data.bessRevenue) : undefined,
          forecastGpPct: data.forecastGpPct != null ? String(data.forecastGpPct) : undefined,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(forecastPipeline.id, id));

      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to update pipeline entry", message: error?.message });
    }
  }
);

router.delete(
  "/api/fye-revenue-tracking/pipeline/:id",
  requireAuth,
  requirePermission("fye_revenue_tracking", "delete"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      // Soft delete - set status to archived
      await db
        .update(forecastPipeline)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(forecastPipeline.id, id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to archive pipeline entry", message: error?.message });
    }
  }
);

// ─── Lost Deals CRUD ───
router.get(
  "/api/fye-revenue-tracking/lost-deals",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = parseInt(String(req.query.fye || getCurrentFye()), 10);
      const rows = await db.select({
        id: lostDeals.id,
        fyeYear: lostDeals.fyeYear,
        dealName: lostDeals.dealName,
        dealValue: lostDeals.dealValue,
        businessDeveloper: lostDeals.businessDeveloper,
        lostReason: lostDeals.lostReason,
        lostDate: lostDeals.lostDate,
        notes: lostDeals.notes,
        updatedAt: lostDeals.updatedAt,
      }).from(lostDeals).where(eq(lostDeals.fyeYear, fye)).orderBy(desc(lostDeals.updatedAt));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch lost deals", message: error?.message });
    }
  }
);

router.post(
  "/api/fye-revenue-tracking/lost-deals",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const lostDealSchema = z.object({
        fyeYear: z.number().optional(),
        dealName: z.string().min(1),
        dealValue: z.string().or(z.number()).optional(),
        businessDeveloper: z.string().optional(),
        lostReason: z.string().optional(),
        lostDate: z.string().optional(),
        notes: z.string().optional(),
      });
      const data = lostDealSchema.parse(req.body);
      const userId = (req as any).user?.id;

      await db.execute(sql`INSERT INTO lost_deals (fye_year, deal_name, deal_value, business_developer, lost_reason, lost_date, notes, created_by, updated_by, created_at, updated_at)
        VALUES (${data.fyeYear || getCurrentFye()}, ${data.dealName}, ${data.dealValue != null ? String(data.dealValue) : null}, ${data.businessDeveloper || null}, ${data.lostReason || null}, ${data.lostDate || null}, ${data.notes || null}, ${userId || null}, ${userId || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);

      const [row] = await db.select({ id: lostDeals.id, dealName: lostDeals.dealName }).from(lostDeals).orderBy(desc(lostDeals.id)).limit(1);
      res.json(row);
    } catch (error: any) {
      res.status(400).json({ error: "Failed to create lost deal", message: error?.message });
    }
  }
);

router.put(
  "/api/fye-revenue-tracking/lost-deals/:id",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const userId = (req as any).user?.id;
      const data = req.body;

      await db
        .update(lostDeals)
        .set({
          ...data,
          dealValue: data.dealValue != null ? String(data.dealValue) : undefined,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(lostDeals.id, id));

      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to update lost deal", message: error?.message });
    }
  }
);

router.delete(
  "/api/fye-revenue-tracking/lost-deals/:id",
  requireAuth,
  requirePermission("fye_revenue_tracking", "delete"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      await db.delete(lostDeals).where(eq(lostDeals.id, id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to delete lost deal", message: error?.message });
    }
  }
);

// ─── KPI Counts ───
router.get(
  "/api/fye-revenue-tracking/kpis",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = parseInt(String(req.query.fye || getCurrentFye()), 10);

      // Try fye_kpi_counters first (manually seeded/editable values)
      try {
        const [counter] = await db
          .select({
            broughtIn: fyeKpiCounters.broughtIn,
            signed: fyeKpiCounters.signed,
          })
          .from(fyeKpiCounters)
          .where(eq(fyeKpiCounters.fyeYear, fye));

        if (counter) {
          return res.json({
            broughtIn: counter.broughtIn,
            signed: counter.signed,
            total: counter.broughtIn + counter.signed,
          });
        }
      } catch {
        // Table may not exist — fall through to derived
      }

      // Fallback: derive from project_info
      const projects = await db
        .select({
          id: projectInfo.id,
          phase: projectInfo.phase,
          signedStatus: projectInfo.signedStatus,
          isActive: projectInfo.isActive,
        })
        .from(projectInfo);

      const activeProjects = projects.filter((p) => p.isActive !== false);
      const signed = activeProjects.filter((p) => p.signedStatus === "SIGNED").length;
      const broughtIn = activeProjects.filter(
        (p) =>
          p.phase &&
          ["Construction", "Commissioning", "Operations", "Complete", "Handover"].some((ph) =>
            (p.phase || "").toLowerCase().includes(ph.toLowerCase())
          )
      ).length;

      res.json({ broughtIn, signed, total: broughtIn + signed });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch KPIs", message: error?.message });
    }
  }
);

// ─── Seed Data (idempotent) ───
// ─── Snapshot data collector ───
async function collectSnapshotData(fye: number) {
  const monthKeys = getFyeMonthKeys(fye);
  const fyeStart = `${fye - 1}-09`;
  const fyeEnd = `${fye}-08`;
  const now = new Date();
  const currentMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Budget
  const budgetRevByMonth: Record<string, number> = {};
  const budgetCosByMonth: Record<string, number> = {};
  try {
    const budgetRows = await db.select({ monthKey: fyeBudgets.monthKey, budgetType: fyeBudgets.budgetType, amount: fyeBudgets.amount }).from(fyeBudgets).where(eq(fyeBudgets.fye, String(fye)));
    for (const b of budgetRows) {
      const amt = safeNum(b.amount);
      if (b.budgetType === "revenue") budgetRevByMonth[b.monthKey] = (budgetRevByMonth[b.monthKey] || 0) + amt;
      else if (b.budgetType === "cos") budgetCosByMonth[b.monthKey] = (budgetCosByMonth[b.monthKey] || 0) + amt;
    }
  } catch {}

  // Actual Revenue
  const allInflows = await db.select({ projectName: programInflows.projectName, milestoneAmount: programInflows.milestoneAmount, paymentReceivedDate: programInflows.paymentReceivedDate }).from(programInflows);
  const actualRevByMonth: Record<string, number> = {};
  for (const inf of allInflows) {
    if (!inf.paymentReceivedDate) continue;
    const mk = extractMonthKey(inf.paymentReceivedDate);
    if (mk && monthKeys.includes(mk)) actualRevByMonth[mk] = (actualRevByMonth[mk] || 0) + safeNum(inf.milestoneAmount);
  }

  // Actual COS
  const allExpenses = await db.select({ projectName: programExpense.projectName, rowType: programExpense.rowType, expenseActualTotal: programExpense.expenseActualTotal, actualCosTotal: programExpense.actualCosTotal, expenseInvoicedDate: programExpense.expenseInvoicedDate }).from(programExpense);
  const actualCosByMonth: Record<string, number> = {};
  for (const exp of allExpenses) {
    if (exp.rowType != null && exp.rowType !== "item") continue;
    const mk = extractMonthKey(exp.expenseInvoicedDate);
    if (mk && monthKeys.includes(mk)) {
      const amt = safeNum(exp.actualCosTotal || exp.expenseActualTotal);
      if (amt !== 0) actualCosByMonth[mk] = (actualCosByMonth[mk] || 0) + amt;
    }
  }

  // Captured
  const capturedRevByMonth: Record<string, number> = {};
  const capturedCosByMonth: Record<string, number> = {};
  try {
    const cRev = await db.select({ monthEndDate: financeRevenueMonthly.monthEndDate, value: financeRevenueMonthly.value }).from(financeRevenueMonthly);
    for (const r of cRev) { const mk = extractMonthKey(r.monthEndDate); if (mk && monthKeys.includes(mk)) capturedRevByMonth[mk] = (capturedRevByMonth[mk] || 0) + safeNum(r.value); }
    const cCos = await db.select({ monthEndDate: financeCosMonthly.monthEndDate, value: financeCosMonthly.value }).from(financeCosMonthly);
    for (const r of cCos) { const mk = extractMonthKey(r.monthEndDate); if (mk && monthKeys.includes(mk)) capturedCosByMonth[mk] = (capturedCosByMonth[mk] || 0) + safeNum(r.value); }
  } catch {}

  // Dashboard months
  const dashboardMonths = monthKeys.map((mk) => {
    const bRev = budgetRevByMonth[mk] || 0, bCos = budgetCosByMonth[mk] || 0;
    const isPast = mk <= currentMk;
    const aRev = isPast ? (actualRevByMonth[mk] || 0) : null;
    const aCos = isPast ? (actualCosByMonth[mk] || 0) : null;
    const cRev = capturedRevByMonth[mk] || null;
    const cCos = capturedCosByMonth[mk] || null;
    const afRev = isPast ? (actualRevByMonth[mk] || 0) : bRev;
    const afCos = isPast ? (actualCosByMonth[mk] || 0) : bCos;
    return {
      monthKey: mk, label: monthKeyToLabel(mk),
      revenue: { budget: bRev, actualForecast: afRev, actual: aRev, captured: cRev !== null ? cRev : (isPast ? 0 : null) },
      cos: { budget: bCos, actualForecast: afCos, actual: aCos, captured: cCos !== null ? cCos : (isPast ? 0 : null) },
      gp: { budget: bRev - bCos, actualForecast: afRev - afCos, actual: aRev !== null && aCos !== null ? aRev - aCos : null, captured: cRev !== null && cCos !== null ? cRev - cCos : (isPast ? 0 : null) },
    };
  });

  // Detail projects
  const projects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName, sizeKwp: projectInfo.sizeKwp, pd: projectInfo.pd, constructionStartDate: projectInfo.constructionStartDate, commissioningDate: projectInfo.commissioningDate, phase: projectInfo.phase, signedStatus: projectInfo.signedStatus, isActive: projectInfo.isActive, contractValue: projectInfo.contractValue }).from(projectInfo);
  const activeProjects = projects.filter((p) => p.isActive !== false);

  // Compute per-project financials
  const inflowsByProject = new Map<string, { budget: number; actual: number }>();
  for (const inf of allInflows) {
    if (!inflowsByProject.has(inf.projectName)) inflowsByProject.set(inf.projectName, { budget: 0, actual: 0 });
    const e = inflowsByProject.get(inf.projectName)!;
    e.budget += safeNum(inf.milestoneAmount);
    if (inf.paymentReceivedDate) { const mk = extractMonthKey(inf.paymentReceivedDate); if (mk && mk >= fyeStart && mk <= fyeEnd) e.actual += safeNum(inf.milestoneAmount); }
  }
  const expensesByProject = new Map<string, { budget: number; actual: number }>();
  for (const exp of allExpenses) {
    if (exp.rowType != null && exp.rowType !== "item") continue;
    if (!expensesByProject.has(exp.projectName)) expensesByProject.set(exp.projectName, { budget: 0, actual: 0 });
    const e = expensesByProject.get(exp.projectName)!;
    const amt = safeNum(exp.actualCosTotal || exp.expenseActualTotal);
    e.budget += amt;
    if (exp.expenseInvoicedDate) { const mk = extractMonthKey(exp.expenseInvoicedDate); if (mk && mk >= fyeStart && mk <= fyeEnd) e.actual += amt; }
  }

  const projectRows = activeProjects.map((p) => {
    const inf = inflowsByProject.get(p.projectName) || { budget: 0, actual: 0 };
    const exp = expensesByProject.get(p.projectName) || { budget: 0, actual: 0 };
    return { projectName: p.projectName, businessDeveloper: p.pd, province: null, sizeKwp: safeNum(p.sizeKwp), status: p.phase, budgetRevenue: inf.budget, budgetCos: exp.budget, budgetGp: inf.budget - exp.budget, actualRevenue: inf.actual, actualExpense: exp.actual, actualGp: inf.actual - exp.actual, budgetGpPct: safeDivide(inf.budget - exp.budget, inf.budget), actualGpPct: safeDivide(inf.actual - exp.actual, inf.actual) };
  });
  const totals = projectRows.reduce((a, r) => ({ budgetRevenue: a.budgetRevenue + r.budgetRevenue, budgetCos: a.budgetCos + r.budgetCos, budgetGp: a.budgetGp + r.budgetGp, actualRevenue: a.actualRevenue + r.actualRevenue, actualExpense: a.actualExpense + r.actualExpense, actualGp: a.actualGp + r.actualGp }), { budgetRevenue: 0, budgetCos: 0, budgetGp: 0, actualRevenue: 0, actualExpense: 0, actualGp: 0 });

  // Pipeline
  let pipelineRows: any[] = [];
  try {
    pipelineRows = await db.select({ id: forecastPipeline.id, projectName: forecastPipeline.projectName, projectDeveloper: forecastPipeline.projectDeveloper, location: forecastPipeline.location, sizeKwp: forecastPipeline.sizeKwp, dealProbabilityPct: forecastPipeline.dealProbabilityPct, forecastSignatureDate: forecastPipeline.forecastSignatureDate, solarRevenue: forecastPipeline.solarRevenue, bessRevenue: forecastPipeline.bessRevenue, forecastGpPct: forecastPipeline.forecastGpPct }).from(forecastPipeline).where(and(eq(forecastPipeline.status, "active"), eq(forecastPipeline.fyeYear, fye)));
  } catch {}

  // Lost deals
  let lostDealRows: any[] = [];
  try {
    lostDealRows = await db.select({ id: lostDeals.id, dealName: lostDeals.dealName, dealValue: lostDeals.dealValue, businessDeveloper: lostDeals.businessDeveloper, lostReason: lostDeals.lostReason, lostDate: lostDeals.lostDate }).from(lostDeals).where(eq(lostDeals.fyeYear, fye));
  } catch {}

  // KPIs
  let kpi = { broughtIn: 0, signed: 0, total: 0 };
  try {
    const [counter] = await db.select({ broughtIn: fyeKpiCounters.broughtIn, signed: fyeKpiCounters.signed }).from(fyeKpiCounters).where(eq(fyeKpiCounters.fyeYear, fye));
    if (counter) kpi = { broughtIn: counter.broughtIn, signed: counter.signed, total: counter.broughtIn + counter.signed };
  } catch {}

  return {
    dashboard: { months: dashboardMonths, monthKeys },
    detail: { projects: projectRows, totals: { ...totals, budgetGpPct: safeDivide(totals.budgetGp, totals.budgetRevenue), actualGpPct: safeDivide(totals.actualGp, totals.actualRevenue) } },
    pipeline: pipelineRows,
    lostDeals: lostDealRows,
    kpi,
  };
}

/** Map calendar month to FYE month index (Sep=1, Oct=2, ..., Aug=12) */
function calendarToFyeMonth(calMonth: number): number {
  return calMonth >= 9 ? calMonth - 8 : calMonth + 4;
}

// ─── Snapshot CRUD ───

router.post(
  "/api/fye-revenue-tracking/snapshots",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const schema = z.object({
        fyeYear: z.number().optional(),
        snapshotLabel: z.string().min(1),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const fye = data.fyeYear || getCurrentFye();
      const userId = (req as any).user?.id;
      const now = new Date();
      const snapshotMonth = calendarToFyeMonth(now.getMonth() + 1);

      const snapshotData = await collectSnapshotData(fye);

      await db.execute(sql`INSERT INTO fye_report_snapshots (fye_year, snapshot_month, snapshot_date, snapshot_label, status, snapshot_data, notes, created_by, created_at)
        VALUES (${fye}, ${snapshotMonth}, ${now.toISOString().slice(0, 10)}, ${data.snapshotLabel}, 'draft', ${JSON.stringify(snapshotData)}, ${data.notes || null}, ${userId || null}, CURRENT_TIMESTAMP)`);

      // Get the inserted row id
      const [last] = await db.select({ id: fyeReportSnapshots.id, snapshotLabel: fyeReportSnapshots.snapshotLabel, status: fyeReportSnapshots.status }).from(fyeReportSnapshots).orderBy(desc(fyeReportSnapshots.id)).limit(1);

      res.json({ id: last.id, snapshotLabel: last.snapshotLabel, status: last.status, message: "Snapshot created as draft" });
    } catch (error: any) {
      console.error("Snapshot create error:", error);
      res.status(400).json({ error: "Failed to create snapshot", message: error?.message });
    }
  }
);

router.get(
  "/api/fye-revenue-tracking/snapshots",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const fye = parseInt(String(req.query.fye || getCurrentFye()), 10);
      const rows = await db.select({
        id: fyeReportSnapshots.id,
        fyeYear: fyeReportSnapshots.fyeYear,
        snapshotMonth: fyeReportSnapshots.snapshotMonth,
        snapshotDate: fyeReportSnapshots.snapshotDate,
        snapshotLabel: fyeReportSnapshots.snapshotLabel,
        status: fyeReportSnapshots.status,
        notes: fyeReportSnapshots.notes,
        createdBy: fyeReportSnapshots.createdBy,
        createdAt: fyeReportSnapshots.createdAt,
        submittedAt: fyeReportSnapshots.submittedAt,
        approvedAt: fyeReportSnapshots.approvedAt,
      }).from(fyeReportSnapshots).where(eq(fyeReportSnapshots.fyeYear, fye)).orderBy(desc(fyeReportSnapshots.snapshotDate));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to list snapshots", message: error?.message });
    }
  }
);

router.get(
  "/api/fye-revenue-tracking/snapshots/:id",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const [row] = await db.select().from(fyeReportSnapshots).where(eq(fyeReportSnapshots.id, id));
      if (!row) return res.status(404).json({ error: "Snapshot not found" });
      res.json({ ...row, snapshotData: JSON.parse(row.snapshotData) });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch snapshot", message: error?.message });
    }
  }
);

router.put(
  "/api/fye-revenue-tracking/snapshots/:id/submit",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const userId = (req as any).user?.id;
      const [row] = await db.select({ status: fyeReportSnapshots.status }).from(fyeReportSnapshots).where(eq(fyeReportSnapshots.id, id));
      if (!row) return res.status(404).json({ error: "Snapshot not found" });
      if (row.status !== "draft") return res.status(400).json({ error: "Only draft snapshots can be submitted" });

      await db.execute(sql`UPDATE fye_report_snapshots SET status = 'submitted', submitted_by = ${userId || null}, submitted_at = CURRENT_TIMESTAMP WHERE id = ${id}`);
      res.json({ ok: true, status: "submitted" });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to submit snapshot", message: error?.message });
    }
  }
);

router.put(
  "/api/fye-revenue-tracking/snapshots/:id/approve",
  requireAuth,
  requirePermission("fye_revenue_tracking", "edit"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const userId = (req as any).user?.id;
      const [row] = await db.select({ status: fyeReportSnapshots.status }).from(fyeReportSnapshots).where(eq(fyeReportSnapshots.id, id));
      if (!row) return res.status(404).json({ error: "Snapshot not found" });
      if (row.status !== "submitted") return res.status(400).json({ error: "Only submitted snapshots can be approved" });

      await db.execute(sql`UPDATE fye_report_snapshots SET status = 'approved', approved_by = ${userId || null}, approved_at = CURRENT_TIMESTAMP WHERE id = ${id}`);
      res.json({ ok: true, status: "approved" });
    } catch (error: any) {
      res.status(400).json({ error: "Failed to approve snapshot", message: error?.message });
    }
  }
);

router.get(
  "/api/fye-revenue-tracking/snapshots/:id/export",
  requireAuth,
  requirePermission("fye_revenue_tracking", "view"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const [row] = await db.select().from(fyeReportSnapshots).where(eq(fyeReportSnapshots.id, id));
      if (!row) return res.status(404).json({ error: "Snapshot not found" });

      const data = JSON.parse(row.snapshotData);
      const workbook = new ExcelJS.Workbook();
      const redFont = { color: { argb: "FFDC2626" } };
      const headerFill: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
      const randFmt = '#,##0;[Red]-#,##0';
      const pctFmt = '0.0%;[Red]-0.0%';

      // Sheet 1: Dashboard
      const dashSheet = workbook.addWorksheet("Dashboard");
      const monthLabels = data.dashboard.months.map((m: any) => m.label);
      const hdrRow = dashSheet.addRow(["", ...monthLabels, "Total"]);
      hdrRow.font = { bold: true };
      hdrRow.fill = headerFill;

      const sections = [
        { title: "Revenue Tracking", key: "revenue" },
        { title: "COS Tracking", key: "cos" },
        { title: "GP Tracking", key: "gp" },
      ];
      const rowTypes = ["budget", "actualForecast", "actual", "captured"];
      const rowLabels: Record<string, string> = { budget: "Budget", actualForecast: "Actual + Forecast", actual: "Actual", captured: "Captured Data" };

      for (const sec of sections) {
        dashSheet.addRow([]);
        const secRow = dashSheet.addRow([sec.title]);
        secRow.font = { bold: true, size: 11 };
        for (const rt of rowTypes) {
          const vals = data.dashboard.months.map((m: any) => m[sec.key]?.[rt] ?? null);
          const nonNull = vals.filter((v: any) => v !== null);
          const total = nonNull.length > 0 ? nonNull.reduce((a: number, b: number) => a + b, 0) : null;
          const xlRow = dashSheet.addRow([rowLabels[rt], ...vals, total]);
          // Apply Rand formatting and red for negatives
          for (let c = 2; c <= xlRow.cellCount; c++) {
            const cell = xlRow.getCell(c);
            if (typeof cell.value === "number") {
              cell.numFmt = randFmt;
              if ((cell.value as number) < 0) cell.font = redFont;
            }
          }
        }
      }

      dashSheet.getColumn(1).width = 20;
      for (let i = 2; i <= monthLabels.length + 2; i++) dashSheet.getColumn(i).width = 16;

      // Sheet 2: FYE Detail
      const detailSheet = workbook.addWorksheet("FYE Detail");

      // Summary
      const t = data.detail.totals;
      detailSheet.addRow(["Summary"]).font = { bold: true, size: 12 };
      const summaryFields = [
        ["Budget Revenue", t.budgetRevenue], ["Budget COS", t.budgetCos], ["Budget GP", t.budgetGp],
        ["Actual Revenue", t.actualRevenue], ["Actual Expense", t.actualExpense], ["Actual GP", t.actualGp],
      ];
      for (const [label, val] of summaryFields) {
        const r = detailSheet.addRow([label, val]);
        r.getCell(2).numFmt = randFmt;
        if (typeof val === "number" && val < 0) r.getCell(2).font = redFont;
      }
      detailSheet.addRow([]);

      // Project table
      const projHdr = detailSheet.addRow(["Project Name", "Business Developer", "Size (kWp)", "Status", "Budget Revenue", "Budget COS", "Budget GP", "Actual Revenue", "Actual Expense", "Actual GP"]);
      projHdr.font = { bold: true };
      projHdr.fill = headerFill;
      for (const p of data.detail.projects) {
        const r = detailSheet.addRow([p.projectName, p.businessDeveloper, p.sizeKwp, p.status, p.budgetRevenue, p.budgetCos, p.budgetGp, p.actualRevenue, p.actualExpense, p.actualGp]);
        for (let c = 5; c <= 10; c++) {
          r.getCell(c).numFmt = randFmt;
          if (typeof r.getCell(c).value === "number" && (r.getCell(c).value as number) < 0) r.getCell(c).font = redFont;
        }
      }
      // Totals row
      const totRow = detailSheet.addRow(["TOTALS", "", "", "", t.budgetRevenue, t.budgetCos, t.budgetGp, t.actualRevenue, t.actualExpense, t.actualGp]);
      totRow.font = { bold: true };
      for (let c = 5; c <= 10; c++) {
        totRow.getCell(c).numFmt = randFmt;
        if (typeof totRow.getCell(c).value === "number" && (totRow.getCell(c).value as number) < 0) totRow.getCell(c).font = { bold: true, ...redFont };
      }
      detailSheet.addRow([]);

      // Pipeline
      detailSheet.addRow(["Pipeline Deals (>= 75%)"]).font = { bold: true, size: 11 };
      const pipHdr = detailSheet.addRow(["Project Name", "Developer", "Location", "Size (kWp)", "Probability %", "Solar Revenue", "BESS Revenue", "GP%", "Forecast GP"]);
      pipHdr.font = { bold: true };
      pipHdr.fill = headerFill;
      for (const p of data.pipeline) {
        const s = parseFloat(p.solarRevenue || "0"), b = parseFloat(p.bessRevenue || "0"), gp = p.forecastGpPct ? parseFloat(p.forecastGpPct) : null;
        const r = detailSheet.addRow([p.projectName, p.projectDeveloper, p.location, p.sizeKwp, p.dealProbabilityPct, s, b, gp != null ? gp : null, gp != null ? gp * (s + b) : null]);
        r.getCell(6).numFmt = randFmt;
        r.getCell(7).numFmt = randFmt;
        if (gp != null) r.getCell(8).numFmt = pctFmt;
        r.getCell(9).numFmt = randFmt;
      }
      detailSheet.addRow([]);

      // Lost Deals
      detailSheet.addRow(["Lost Deals"]).font = { bold: true, size: 11 };
      const lostHdr = detailSheet.addRow(["Deal Name", "Deal Value", "Business Developer", "Lost Reason"]);
      lostHdr.font = { bold: true };
      lostHdr.fill = headerFill;
      for (const d of data.lostDeals) {
        const r = detailSheet.addRow([d.dealName, parseFloat(d.dealValue || "0"), d.businessDeveloper, d.lostReason]);
        r.getCell(2).numFmt = randFmt;
      }
      detailSheet.addRow([]);

      // KPIs
      detailSheet.addRow(["KPI Counters"]).font = { bold: true, size: 11 };
      detailSheet.addRow(["Brought In", data.kpi.broughtIn]);
      detailSheet.addRow(["Signed", data.kpi.signed]);
      const kpiTotal = detailSheet.addRow(["Total", data.kpi.total]);
      kpiTotal.font = { bold: true };

      detailSheet.getColumn(1).width = 30;
      for (let i = 2; i <= 10; i++) detailSheet.getColumn(i).width = 16;

      const safeLabel = row.snapshotLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="FYE_${row.fyeYear}_Revenue_Tracking_${safeLabel}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Snapshot export error:", error);
      res.status(500).json({ error: "Failed to export snapshot", message: error?.message });
    }
  }
);

// ─── Seed Data (idempotent) ───
async function seedFyeData() {
  try {
    // Seed pipeline deals for FYE 2026 — uses raw SQL to avoid Drizzle defaultNow() on SQLite
    const existingPipeline = await db
      .select({ id: forecastPipeline.id })
      .from(forecastPipeline)
      .limit(1);

    if (existingPipeline.length === 0) {
      const pipelineDeals = [
        [2026,"Engen Mbekweni","Cole Bisset","Paarl","130",90,"2026-11-30","761633","0","0.20"],
        [2026,"Wolwendrift Trust","Cole Bisset","Cape Town","75",95,"2025-11-24","1682698","0","0.1958"],
        [2026,"GIMCO-6th Avenue Shopping Centre","Gordon Upton","Port Elizabeth","250",100,"2025-11-28","3414591.17","0","0.1862"],
        [2026,"Volvo Moffett Retail Park","Gordon Upton","Port Elizabeth","45",100,"2025-12-31","1251129","631416","0.20"],
        [2026,"Moffett Retail Park deal","Gordon Upton","Port Elizabeth","715",100,"2025-12-31","5669948","0","0.1659"],
        [2026,"Saxon Industrial Park","Cole Bisset","Cape Town","182",80,"2026-02-09","1699292","0","0.15"],
        [2026,"SPEK deal","Cole Bisset","Cape Town","670",75,"2026-02-23","5004014","0","0.13"],
        [2026,"Pangea Made - Finishing deal","Gordon Upton","Joburg","252",80,"2026-02-27","2729166","0","0.16"],
        [2026,"Pangea Made - Cutting","Gordon Upton","Joburg","185",80,"2026-02-27","1597247","0","0.18"],
        [2026,"WEG - 6 Laneshaw","Cole Bisset","Joburg","480",80,"2026-03-23","9946481","5134357","0.13"],
        [2026,"Pick n Pay Bethal","Megan Moore","Gauteng","420",80,"2026-03-31","3530327","0","0.17"],
        [2026,"Pick n Pay Secunda deal","Megan Moore","Joburg","303",80,"2026-04-30","4351728","763673","0.17"],
        [2026,"Freshco","Gordon Upton","Port Elizabeth","350",75,"2026-06-01","8456914","5018177","0.10"],
        [2026,"Wilec Clayville Deal","Megan Moore","Joburg","1200",80,"2026-06-30","10191761","0","0.11"],
        [2026,"Unitrans Brackenfell","Cole Bisset","Cape Town","188",95,"2025-12-10","1900000","3700000",null],
      ];
      for (const d of pipelineDeals) {
        await db.execute(sql`INSERT INTO forecast_pipeline (fye_year, project_name, project_developer, location, size_kwp, deal_probability_pct, forecast_signature_date, solar_revenue, bess_revenue, forecast_gp_pct, status, created_at, updated_at)
          VALUES (${d[0]}, ${d[1]}, ${d[2]}, ${d[3]}, ${d[4]}, ${d[5]}, ${d[6]}, ${d[7]}, ${d[8]}, ${d[9]}, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
      }
      console.log("[FYE Seed] Inserted 15 pipeline deals");
    }

    // Seed lost deals for FYE 2026
    const existingLost = await db
      .select({ id: lostDeals.id })
      .from(lostDeals)
      .limit(1);

    if (existingLost.length === 0) {
      const lostDealData = [
        [2026,"House Anand","1000000","Gordon Upton","Wanted Sunsync instead of Victron"],
        [2026,"Volvo Trucks JetPark Phase 2","10443453.63","Megan Moore","Lost tender - too expensive"],
        [2026,"Wanderers Club (Padel) deal","3970811","Megan Moore","Went ahead with someone else connected to the board"],
        [2026,"Green Gate deal (DS) PEET","10862099","Peet Verreynne","Lost to EP - PPA 10 cents cheaper"],
        [2026,"Volvo Trucks JetPark Phase 1","3142443.69","Megan Moore","Lost tender - too expensive"],
        [2026,"Neulux Park deal","1968450","Gordon Upton","Lost to someone else"],
      ];
      for (const d of lostDealData) {
        await db.execute(sql`INSERT INTO lost_deals (fye_year, deal_name, deal_value, business_developer, lost_reason, created_at, updated_at)
          VALUES (${d[0]}, ${d[1]}, ${d[2]}, ${d[3]}, ${d[4]}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
      }
      console.log("[FYE Seed] Inserted 6 lost deals");
    }

    // Seed KPI counters for FYE 2026
    const existingKpi = await db
      .select({ id: fyeKpiCounters.id })
      .from(fyeKpiCounters)
      .where(eq(fyeKpiCounters.fyeYear, 2026))
      .limit(1);

    if (existingKpi.length === 0) {
      await db.execute(sql`INSERT INTO fye_kpi_counters (fye_year, brought_in, signed, created_at, updated_at)
        VALUES (2026, 26, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
      console.log("[FYE Seed] Inserted KPI counters for FYE 2026");
    }
  } catch (err: any) {
    console.error("[FYE Seed] Error:", err.message);
  }
}

export function registerFyeRevenueTrackingRoutes(app: Express) {
  app.use(router);
  // Run seed on startup (idempotent)
  seedFyeData().catch(() => {});
}
