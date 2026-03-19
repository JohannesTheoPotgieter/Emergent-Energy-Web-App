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
} from "@shared/schema";
import { eq, and, sql, gte, lte, desc, inArray } from "drizzle-orm";
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
          .select()
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
      const rows = await db.select().from(fyeBudgets).where(eq(fyeBudgets.fye, fye));
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
        .select()
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

        await db.insert(fyeBudgets).values({
          projectId: proj?.id || null,
          projectName: data.projectName,
          fye: data.fye,
          monthKey: data.monthKey,
          budgetType: data.budgetType,
          amount: String(data.amount),
          updatedBy: userId,
        });
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
  async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(forecastPipeline)
        .where(eq(forecastPipeline.status, "active"))
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
      const schema = z.object({
        projectName: z.string().min(1),
        projectDeveloper: z.string().optional(),
        location: z.string().optional(),
        sizeKwp: z.string().or(z.number()).optional(),
        dealProbabilityPct: z.number().min(0).max(100),
        forecastSignatureDate: z.string().optional(),
        solarRevenue: z.string().or(z.number()).optional(),
        bessRevenue: z.string().or(z.number()).optional(),
        forecastGpPct: z.string().or(z.number()).optional(),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const userId = (req as any).user?.id;

      const [row] = await db
        .insert(forecastPipeline)
        .values({
          projectName: data.projectName,
          projectDeveloper: data.projectDeveloper || null,
          location: data.location || null,
          sizeKwp: data.sizeKwp != null ? String(data.sizeKwp) : null,
          dealProbabilityPct: data.dealProbabilityPct,
          forecastSignatureDate: data.forecastSignatureDate || null,
          solarRevenue: data.solarRevenue != null ? String(data.solarRevenue) : "0",
          bessRevenue: data.bessRevenue != null ? String(data.bessRevenue) : "0",
          forecastGpPct: data.forecastGpPct != null ? String(data.forecastGpPct) : "0",
          notes: data.notes || null,
          updatedBy: userId,
        })
        .returning();

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
  async (_req, res) => {
    try {
      const rows = await db.select().from(lostDeals).orderBy(desc(lostDeals.updatedAt));
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
      const schema = z.object({
        dealName: z.string().min(1),
        dealValue: z.string().or(z.number()).optional(),
        businessDeveloper: z.string().optional(),
        lostReason: z.string().optional(),
        lostDate: z.string().optional(),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const userId = (req as any).user?.id;

      const [row] = await db
        .insert(lostDeals)
        .values({
          dealName: data.dealName,
          dealValue: data.dealValue != null ? String(data.dealValue) : null,
          businessDeveloper: data.businessDeveloper || null,
          lostReason: data.lostReason || null,
          lostDate: data.lostDate || null,
          notes: data.notes || null,
          updatedBy: userId,
        })
        .returning();

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
  async (_req, res) => {
    try {
      const projects = await db
        .select({
          id: projectInfo.id,
          phase: projectInfo.phase,
          signedStatus: projectInfo.signedStatus,
          isActive: projectInfo.isActive,
        })
        .from(projectInfo)
        .where(eq(projectInfo.isActive, true));

      // "Signed" = projects with signedStatus = 'SIGNED'
      const signed = projects.filter((p) => p.signedStatus === "SIGNED").length;
      // "Brought In" = active projects in execution phases (construction/commissioning/operations/complete/handover)
      const broughtIn = projects.filter(
        (p) =>
          p.phase &&
          ["Construction", "Commissioning", "Operations", "Complete", "Handover"].some((ph) =>
            (p.phase || "").toLowerCase().includes(ph.toLowerCase())
          )
      ).length;
      const total = broughtIn + signed;

      res.json({ broughtIn, signed, total });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch KPIs", message: error?.message });
    }
  }
);

export function registerFyeRevenueTrackingRoutes(app: Express) {
  app.use(router);
}
