import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { paramInt } from "../lib/req-parse";
import { eq, and, sql, isNull } from "drizzle-orm";
import { projectInfo } from "@shared/schema";
import { logAuditFromReq } from "../audit-logger";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import { scoreExpenseConfidence, scoreInflowConfidence, getAssumptionDriver } from "../lib/calculations/confidence";
import { aggregateCOS, aggregateCOSByProject } from "../lib/calculations/cosAggregator";
import { computeWeeklyCashflow, getLinesForWeek, type CashflowLineItem } from "../lib/calculations/cashflow";
import { runDataQualityChecks } from "../lib/calculations/dataQuality";
import { isCanonicalCosRealised } from "../lib/finance/cos-realisation";
import { computeMonthlyBuckets } from "../lib/calculations/monthlyBuckets";
import { getCosEffectiveDateAndSource } from "../lib/expense-row-selector";
import { classifyCosStatusFull } from "../lib/calculations/financeUtils";
import { getCanonicalAllCurrentCostLines } from "../services/project-cost-line-read-service";
import { setFinanceTrustHeaders } from "../lib/finance-trust/envelope";
import { getMergedExpensesAndInflows, resolveInflowEffectiveDates } from "../lib/cashflow-helpers";

// Unified realisation check: delegates to canonical isCanonicalCosRealised()
// to stay aligned with COS Tracker, Company Overview, Dashboard Metrics, etc.
function isCosRealisedCheck(exp: any): boolean {
  return isCanonicalCosRealised({
    status: exp.status ?? exp.line_status ?? null,
    cosStatusOverride: exp._cosOverrideStatus ?? exp.cosStatusOverride ?? null,
    cosRealised: exp.cosRealised ?? null,
    expenseInvoiceNumber: exp.expenseInvoiceNumber ?? exp.invoiceNumber ?? null,
    expenseInvoicedDate: exp.expenseInvoicedDate ?? exp.invoiceDate ?? null,
    expensePoNumber: exp.expensePoNumber ?? exp.poNumber ?? null,
    paymentDate: exp.expensePaymentDate ?? exp.paymentDate ?? exp.paidDate ?? null,
    today: new Date().toISOString().slice(0, 10),
    invoiceDateFontColor: exp.invoiceDateFontColor ?? null,
    invoiceDateConfirmed: exp.invoiceDateConfirmed ?? null,
  });
}

function isEffectivelyRealisedLocal(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  return isCanonicalCosRealised({
    status: exp.status ?? exp.line_status ?? null,
    cosStatusOverride: exp._cosOverrideStatus ?? exp.cosStatusOverride ?? null,
    cosRealised: exp.cosRealised ?? null,
    expenseInvoiceNumber: exp.expenseInvoiceNumber ?? exp.invoiceNumber ?? null,
    expenseInvoicedDate: exp.expenseInvoicedDate ?? exp.invoiceDate ?? null,
    expensePoNumber: exp.expensePoNumber ?? exp.poNumber ?? null,
    paymentDate: exp.expensePaymentDate ?? exp.paymentDate ?? exp.paidDate ?? null,
    today: new Date().toISOString().slice(0, 10),
    invoiceDateFontColor: exp.invoiceDateFontColor ?? null,
    invoiceDateConfirmed: exp.invoiceDateConfirmed ?? null,
  });
}

// § 3.3 RECOGNITION amount: ACTUAL only — budget is NEVER substituted (that would
// recognise unincurred cost). Used on every COS recognition surface.
export function recognitionActualAmount(e: any): number {
  const v = parseFloat(e?.expenseActualTotal || '0');
  return Number.isFinite(v) ? v : 0;
}

// § 3.4 CASH outflow amount — the cashflow-forecast surfaces' own (actual-else-
// budget) logic, kept SEPARATE and clearly named. Cash logic unchanged.
export function cashOutflowAmount(e: any): number {
  const v = parseFloat(e?.expenseActualTotal || e?.budgetTotal || '0');
  return Number.isFinite(v) ? v : 0;
}

export function registerCosControlRoutes(app: Express) {
  // =========================================================================
  // COS CONTROL TOWER APIs
  // =========================================================================

  app.get("/api/cos-control/summary", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const legacyExp = await getCanonicalAllCurrentCostLines();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const lines = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = recognitionActualAmount(e);
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          amount: Math.abs(recognitionActualAmount(e)),
          state: e.computedState || classifyExpenseState(e),
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          invoicedDate: e.expenseInvoicedDate,
          paymentDate: e.expensePaymentDate,
          forecastPaymentDate: e.computedForecastPaymentDate,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
        }));

      const summary = aggregateCOS(lines as any);
      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "normalized_cost_lines",
      });
      res.json(summary);
    } catch (err: any) {
      console.error('[COS Control] summary error:', err);
      throw err;
    }
  });

  app.get("/api/cos-control/by-project", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const legacyExp = await getCanonicalAllCurrentCostLines();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const lines = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = recognitionActualAmount(e);
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          amount: Math.abs(recognitionActualAmount(e)),
          state: e.computedState || classifyExpenseState(e),
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          invoicedDate: e.expenseInvoicedDate,
          paymentDate: e.expensePaymentDate,
          forecastPaymentDate: e.computedForecastPaymentDate,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
        }));

      const byProject = aggregateCOSByProject(lines as any);
      res.json(byProject);
    } catch (err: any) {
      console.error('[COS Control] by-project error:', err);
      throw err;
    }
  });

  app.get("/api/cos-control/lines", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const { project, state, supplier, search } = req.query;
      const legacyExp = await getCanonicalAllCurrentCostLines();
      let expenses = (await getMergedExpensesAndInflows(legacyExp, [])).expenses;

      let lines = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = recognitionActualAmount(e);
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          hash: e.expenseLineHash,
          projectName: e.projectName,
          category: e.expenseCategory,
          lineItem: e.expenseLineItem,
          budgetTotal: parseFloat(e.budgetTotal || '0'),
          actualTotal: parseFloat(e.expenseActualTotal || '0'),
          state: e.computedState || classifyExpenseState(e),
          poNumber: e.expensePoNumber,
          invoiceNumber: e.expenseInvoiceNumber,
          invoicedDate: e.expenseInvoicedDate,
          paymentDate: e.expensePaymentDate,
          forecastPaymentDate: e.computedForecastPaymentDate,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
        }));

      if (project) lines = lines.filter((l: any) => l.projectName === project);
      if (state) lines = lines.filter((l: any) => l.state === state);
      if (supplier) lines = lines.filter((l: any) => l.supplierName === supplier);
      if (search) {
        const q = String(search).toLowerCase();
        lines = lines.filter((l: any) =>
          (l.lineItem && l.lineItem.toLowerCase().includes(q)) ||
          (l.invoiceNumber && l.invoiceNumber.toLowerCase().includes(q)) ||
          (l.poNumber && l.poNumber.toLowerCase().includes(q)) ||
          (l.supplierName && l.supplierName.toLowerCase().includes(q))
        );
      }

      res.json({ lines, total: lines.length });
    } catch (err: any) {
      console.error('[COS Control] lines error:', err);
      throw err;
    }
  });

  app.get("/api/cos-control/invoices", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const legacyExp = await getCanonicalAllCurrentCostLines();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const invoiceMap = new Map<string, any>();

      for (const e of expenses) {
        if (!e.expenseInvoiceNumber || !e.expenseInvoiceNumber.trim()) continue;
        const inv = e.expenseInvoiceNumber.trim();
        if (!invoiceMap.has(inv)) {
          invoiceMap.set(inv, {
            invoiceNumber: inv,
            totalAmount: 0,
            projects: new Set<string>(),
            state: e.computedState || classifyExpenseState(e),
            invoicedDate: e.expenseInvoicedDate,
            paymentDate: e.expensePaymentDate,
            supplierName: e.supplierName,
            lineCount: 0,
          });
        }
        const entry = invoiceMap.get(inv)!;
        entry.totalAmount += Math.abs(parseFloat(e.expenseActualTotal || '0'));
        entry.projects.add(e.projectName);
        entry.lineCount++;
      }

      const invoices = Array.from(invoiceMap.values()).map(i => ({
        ...i,
        projects: Array.from(i.projects),
      })).sort((a, b) => b.totalAmount - a.totalAmount);

      res.json({ invoices, total: invoices.length });
    } catch (err: any) {
      console.error('[COS Control] invoices error:', err);
      throw err;
    }
  });

  app.get("/api/cos-control/pos", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const legacyExp = await getCanonicalAllCurrentCostLines();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const poMap = new Map<string, any>();

      for (const e of expenses) {
        if (!e.expensePoNumber || !e.expensePoNumber.trim()) continue;
        const po = e.expensePoNumber.trim();
        if (!poMap.has(po)) {
          poMap.set(po, {
            poNumber: po,
            totalAmount: 0,
            projects: new Set<string>(),
            invoiceNumbers: new Set<string>(),
            supplierName: e.supplierName,
            lineCount: 0,
          });
        }
        const entry = poMap.get(po)!;
        entry.totalAmount += Math.abs(recognitionActualAmount(e));
        entry.projects.add(e.projectName);
        if (e.expenseInvoiceNumber) entry.invoiceNumbers.add(e.expenseInvoiceNumber);
        entry.lineCount++;
      }

      const pos = Array.from(poMap.values()).map(p => ({
        ...p,
        projects: Array.from(p.projects),
        invoiceNumbers: Array.from(p.invoiceNumbers),
      })).sort((a, b) => b.totalAmount - a.totalAmount);

      res.json({ pos, total: pos.length });
    } catch (err: any) {
      console.error('[COS Control] POs error:', err);
      throw err;
    }
  });

  // =========================================================================
  // CASHFLOW FORECAST APIs
  // =========================================================================

  app.get("/api/cashflow-forecast/weekly", requireAuth, requirePermission("cashflow_forecast", "view"), async (req, res) => {
    try {

      const weeks = parseInt(String(req.query.weeks || '52'));
      const startDate = String(req.query.start || new Date().toISOString().split('T')[0]);

      const [legacyExp, legacyInf, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        getCanonicalAllCurrentCostLines(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedForecast = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const expenses = mergedForecast.expenses;
      const resolvedInflows = resolveInflowEffectiveDates(mergedForecast.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const outflowLines: CashflowLineItem[] = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = cashOutflowAmount(e);
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          type: 'outflow' as const,
          amount: Math.abs(cashOutflowAmount(e)),
          actualDate: e.expensePaymentDate || null,
          forecastDate: e.computedForecastPaymentDate || null,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
          description: e.expenseLineItem || e.expenseCategory || 'Unknown',
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          category: e.expenseCategory,
          supplierName: e.supplierName,
        }));

      const inflowLines: CashflowLineItem[] = resolvedInflows
        .filter((inf: any) => {
          const amt = parseFloat(inf.milestoneAmount || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((inf: any) => ({
          id: inf.id,
          projectName: inf.projectName,
          type: 'inflow' as const,
          amount: Math.abs(parseFloat(inf.milestoneAmount || '0')),
          actualDate: inf.paymentReceivedDate || null,
          forecastDate: inf.effectiveDate !== inf.paymentReceivedDate ? inf.effectiveDate : (inf.computedForecastReceiptDate || null),
          confidence: scoreInflowConfidence(inf),
          assumptionDriver: inf.paymentReceivedDate ? 'Actual receipt' : (inf.effectiveDate !== inf.computedForecastReceiptDate && inf.effectiveDate !== inf.plannedPaymentDate ? 'Override/linked task' : (inf.invoiceRaisedDate ? 'Invoice raised + terms' : 'Planned date')),
          description: inf.milestoneName || 'Revenue milestone',
          invoiceNumber: inf.milestoneInvoiceNumber,
          poNumber: null,
          category: 'Revenue',
          supplierName: null,
        }));

      const weeklyData = computeWeeklyCashflow(inflowLines, outflowLines, startDate, weeks);
      res.json({ weeks: weeklyData, totalInflows: inflowLines.length, totalOutflows: outflowLines.length });
    } catch (err: any) {
      console.error('[Cashflow Forecast] weekly error:', err);
      throw err;
    }
  });

  app.get("/api/cashflow-forecast/week-detail", requireAuth, requirePermission("cashflow_forecast", "view"), async (req, res) => {
    try {

      const weekStart = String(req.query.weekStart);
      const weekEnd = String(req.query.weekEnd);

      if (!weekStart || !weekEnd) {
        return res.status(400).json({ error: 'weekStart and weekEnd required' });
      }

      const [legacyExp2, legacyInf2, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        getCanonicalAllCurrentCostLines(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedWeekDetail = await getMergedExpensesAndInflows(legacyExp2, legacyInf2);
      const resolvedInflows = resolveInflowEffectiveDates(mergedWeekDetail.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const outflowLines: CashflowLineItem[] = mergedWeekDetail.expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = cashOutflowAmount(e);
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          type: 'outflow' as const,
          amount: Math.abs(cashOutflowAmount(e)),
          actualDate: e.expensePaymentDate || null,
          forecastDate: e.computedForecastPaymentDate || null,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
          description: e.expenseLineItem || e.expenseCategory || 'Unknown',
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          category: e.expenseCategory,
          supplierName: e.supplierName,
        }));

      const inflowLines: CashflowLineItem[] = resolvedInflows
        .filter((inf: any) => {
          const amt = parseFloat(inf.milestoneAmount || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((inf: any) => ({
          id: inf.id,
          projectName: inf.projectName,
          type: 'inflow' as const,
          amount: Math.abs(parseFloat(inf.milestoneAmount || '0')),
          actualDate: inf.paymentReceivedDate || null,
          forecastDate: inf.effectiveDate !== inf.paymentReceivedDate ? inf.effectiveDate : (inf.computedForecastReceiptDate || null),
          confidence: scoreInflowConfidence(inf),
          assumptionDriver: inf.paymentReceivedDate ? 'Actual receipt' : (inf.invoiceRaisedDate ? 'Invoice raised + terms' : 'Planned date'),
          description: inf.milestoneName || 'Revenue milestone',
          invoiceNumber: inf.milestoneInvoiceNumber,
          poNumber: null,
          category: 'Revenue',
          supplierName: null,
        }));

      const allLines = [...inflowLines, ...outflowLines];
      const weekLines = getLinesForWeek(allLines, weekStart, weekEnd);
      res.json({ lines: weekLines, total: weekLines.length });
    } catch (err: any) {
      console.error('[Cashflow Forecast] week-detail error:', err);
      throw err;
    }
  });

  // =========================================================================
  // DATA QUALITY APIs
  // =========================================================================

  app.get("/api/data-quality/scan", requireAuth, requireAdmin, async (req, res) => {
    try {

      const legacyExpDQ = await getCanonicalAllCurrentCostLines();
      const legacyInfDQ = await storage.getAllProgramInflows();
      const mergedDQ = await getMergedExpensesAndInflows(legacyExpDQ, legacyInfDQ);
      const expenses = mergedDQ.expenses;
      const inflows = mergedDQ.inflows;
      const projects = await db.select().from(projectInfo);

      const expenseInputs = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          expenseActualTotal: e.expenseActualTotal,
          expenseInvoiceNumber: e.expenseInvoiceNumber,
          expenseInvoicedDate: e.expenseInvoicedDate,
          expensePaymentDate: e.expensePaymentDate,
          expensePoNumber: e.expensePoNumber,
          supplierName: e.supplierName,
        }));

      const inflowInputs = inflows.map((inf: any) => ({
        id: inf.id,
        projectName: inf.projectName,
        milestoneName: inf.milestoneName,
        milestoneAmount: inf.milestoneAmount,
        milestoneInvoiceNumber: inf.milestoneInvoiceNumber,
        invoiceRaisedDate: inf.invoiceRaisedDate,
        paymentReceivedDate: inf.paymentReceivedDate,
      }));

      const projectInputs = projects.map((p: any) => ({
        projectName: p.projectName,
        pm: p.pm,
        constructionStartDate: p.constructionStartDate,
        commissioningDate: p.commissioningDate,
      }));

      const issues = runDataQualityChecks(expenseInputs, inflowInputs, projectInputs);
      const errorCount = issues.filter(i => i.severity === 'Error').reduce((s, i) => s + i.count, 0);
      const warningCount = issues.filter(i => i.severity === 'Warning').reduce((s, i) => s + i.count, 0);
      const infoCount = issues.filter(i => i.severity === 'Info').reduce((s, i) => s + i.count, 0);

      res.json({
        issues,
        summary: { errorCount, warningCount, infoCount, totalIssues: errorCount + warningCount + infoCount },
      });
    } catch (err: any) {
      console.error('[Data Quality] scan error:', err);
      throw err;
    }
  });

  // =========================================================================
  // BACKFILL TRIGGER
  // =========================================================================

  app.post("/api/admin/backfill", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { runBackfill } = await import("../lib/backfill");
      await runBackfill();
      logAuditFromReq(req, { entityType: "system", action: "backfill", source: "SYSTEM" });
      res.json({ success: true, message: 'Backfill completed' });
    } catch (err: any) {
      console.error('[Admin] backfill error:', err);
      throw err;
    }
  });

  app.post("/api/admin/backfill-invoice-confirmed", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { backfillInvoiceDateConfirmed } = await import("../backfillInvoiceConfirmed");
      const result = await backfillInvoiceDateConfirmed();
      console.log('[Admin] Invoice date confirmed backfill:', result);
      logAuditFromReq(req, { entityType: "system", action: "backfill_invoice_confirmed", source: "SYSTEM", changesJson: result });
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[Admin] invoice confirmed backfill error:', err);
      throw err;
    }
  });

  // =========================================================================
  // PLANNING BOARD APIs
  // =========================================================================

  app.get("/api/planning-board/pm-capacity", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projects = await db.select().from(projectInfo);

      const pms = new Map<string, { pm: string; projects: { projectName: string; start: string | null; end: string | null; phase: string | null }[] }>();

      for (const p of projects) {
        const pmName = (p as any).pm || "Unassigned";
        if (!pms.has(pmName)) {
          pms.set(pmName, { pm: pmName, projects: [] });
        }
        pms.get(pmName)!.projects.push({
          projectName: p.projectName,
          start: (p as any).constructionStartDate,
          end: (p as any).commissioningDate,
          phase: (p as any).phase,
        });
      }

      const startDate = new Date(2025, 8, 1);
      const weeks: string[] = [];
      for (let i = 0; i < 52; i++) {
        const wk = new Date(startDate);
        wk.setDate(wk.getDate() + i * 7);
        weeks.push(wk.toISOString().split('T')[0]);
      }

      const heatmap = Array.from(pms.values()).map(entry => {
        const weekCounts = weeks.map(weekStart => {
          const ws = new Date(weekStart);
          const we = new Date(ws);
          we.setDate(we.getDate() + 7);
          let count = 0;
          for (const proj of entry.projects) {
            if (!proj.start && !proj.end) continue;
            const ps = proj.start ? new Date(proj.start) : new Date(0);
            const pe = proj.end ? new Date(proj.end) : new Date(2030, 0, 1);
            if (ps < we && pe > ws) count++;
          }
          return count;
        });
        return {
          pm: entry.pm,
          projectCount: entry.projects.length,
          weekCounts,
        };
      }).sort((a, b) => b.projectCount - a.projectCount);

      res.json({ weeks, heatmap });
    } catch (err: any) {
      console.error('[Planning Board] capacity error:', err);
      throw err;
    }
  });

  app.get("/api/planning-board/projects", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projects = await db.select().from(projectInfo);
      const legacyExpPB = await getCanonicalAllCurrentCostLines();
      const legacyInfPB = await storage.getAllProgramInflows();
      const mergedPB = await getMergedExpensesAndInflows(legacyExpPB, legacyInfPB);
      const expenses = mergedPB.expenses;
      const inflows = mergedPB.inflows;

      const projectData = projects.map((p: any) => {
        const projExpenses = expenses.filter((e: any) => e.projectName === p.projectName && (e.rowType === 'item' || !e.rowType));
        const projInflows = inflows.filter((inf: any) => inf.projectName === p.projectName);

        const totalBudget = projExpenses.reduce((sum: number, e: any) => sum + Math.abs(parseFloat(e.budgetTotal || '0')), 0);
        const totalActual = projExpenses.reduce((sum: number, e: any) => sum + Math.abs(parseFloat(e.expenseActualTotal || '0')), 0);
        const totalRevenue = projInflows.reduce((sum: number, inf: any) => sum + Math.abs(parseFloat(inf.milestoneAmount || '0')), 0);
        const totalReceived = projInflows
          .filter((inf: any) => inf.paymentReceivedDate)
          .reduce((sum: number, inf: any) => sum + Math.abs(parseFloat(inf.milestoneAmount || '0')), 0);

        const riskFlags: string[] = [];
        if (totalActual > totalBudget * 1.1 && totalBudget > 0) riskFlags.push('Over costed');
        if (!p.constructionStartDate) riskFlags.push('No start date');
        if (!p.commissioningDate) riskFlags.push('No commissioning date');
        if (!p.pm) riskFlags.push('No PM assigned');
        if (totalReceived === 0 && totalRevenue > 0) riskFlags.push('No revenue received');

        return {
          projectName: p.projectName,
          pm: p.pm,
          phase: p.phase,
          sizeKwp: p.sizeKwp,
          constructionStartDate: p.constructionStartDate,
          commissioningDate: p.commissioningDate,
          totalBudget,
          totalActual,
          totalRevenue,
          totalReceived,
          budgetVariance: totalBudget > 0 ? ((totalActual - totalBudget) / totalBudget * 100) : 0,
          revenueRealized: totalRevenue > 0 ? (totalReceived / totalRevenue * 100) : 0,
          expenseLineCount: projExpenses.length,
          inflowLineCount: projInflows.length,
          riskFlags,
        };
      }).sort((a: any, b: any) => b.riskFlags.length - a.riskFlags.length);

      res.json({ projects: projectData, total: projectData.length });
    } catch (err: any) {
      console.error('[Planning Board] projects error:', err);
      throw err;
    }
  });

  // ============ SCENARIO ENGINE API ============

  app.get("/api/scenarios", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const all = await (storage as any).getAllScenarios();
      res.json({ scenarios: all });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/scenarios", requireAuth, requirePermission("cos_control", "edit"), async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const userId = (req.user as any)?.id;
      const scenario = await (storage as any).createScenario({ name, description, createdBy: userId, isDefault: false });
      logAuditFromReq(req, { entityType: "scenario", action: "create", entityId: String(scenario.id), changesJson: { description: "Scenario created", name } });
      res.json(scenario);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/scenarios/:id/duplicate", requireAuth, requirePermission("cos_control", "edit"), async (req, res) => {
    try {
      const id = paramInt(req, "id") ?? 0;
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const dup = await (storage as any).duplicateScenario(id, name);
      logAuditFromReq(req, { entityType: "scenario", action: "duplicate", entityId: String(id), changesJson: { description: "Scenario duplicated", sourceId: id, newName: name } });
      res.json(dup);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/scenarios/:id", requireAuth, requirePermission("cos_control", "edit"), async (req, res) => {
    try {
      const id = paramInt(req, "id") ?? 0;
      await (storage as any).deleteScenario(id);
      logAuditFromReq(req, { entityType: "scenario", action: "delete", entityId: String(id), changesJson: { description: "Scenario deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/scenarios/:id/reset", requireAuth, requirePermission("cos_control", "edit"), async (req, res) => {
    try {
      const id = paramInt(req, "id") ?? 0;
      await (storage as any).clearDateOverrides(id);
      logAuditFromReq(req, { entityType: "scenario", action: "reset", entityId: String(id), changesJson: { description: "Scenario date overrides cleared" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ============ SCENARIO-AWARE COS CONTROL API ============

  app.get("/api/cos-control/scenario-monthly", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const legacyExpSM = await getCanonicalAllCurrentCostLines();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSM, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const cosLines: any[] = items.map((e: any) => ({
        id: e.id,
        projectName: e.projectName,
        expenseCategory: e.expenseCategory,
        expenseLineItem: e.expenseLineItem,
        amount: Math.abs(recognitionActualAmount(e)),
        state: e.computedState || classifyExpenseState(e),
        invoiceNumber: e.expenseInvoiceNumber,
        poNumber: e.expensePoNumber,
        invoicedDate: e.expenseInvoicedDate,
        paymentDate: e.expensePaymentDate,
        forecastPaymentDate: e.computedForecastPaymentDate || e.forecastPaymentDate,
        supplierName: e.supplierName,
        confidence: scoreExpenseConfidence(e),
        assumptionDriver: getAssumptionDriver(e, 30),
        hash: e.expenseLineHash,
      }));

      let scenarioLines = cosLines;
      const baselineResult = computeMonthlyBuckets(cosLines);
      let baselineMonthly = baselineResult.buckets;

      if (scenarioId) {
        const overrideMap = new Map();
        scenarioLines = cosLines;
      }

      const scenarioResult = computeMonthlyBuckets(scenarioLines);
      const scenarioMonthly = scenarioResult.buckets;

      const allMonths = new Set([...baselineMonthly.keys(), ...scenarioMonthly.keys()]);
      const sortedMonths = Array.from(allMonths).sort();

      const monthlyData = sortedMonths.map(month => {
        const baseline = baselineMonthly.get(month) || { planned: 0, committed: 0, invoiced: 0, paid: 0 };
        const scenario = scenarioMonthly.get(month) || { planned: 0, committed: 0, invoiced: 0, paid: 0 };
        const baseTotal = baseline.planned + baseline.committed + baseline.invoiced + baseline.paid;
        const scenTotal = scenario.planned + scenario.committed + scenario.invoiced + scenario.paid;
        return {
          month,
          ...scenario,
          total: scenTotal,
          baselinePlanned: baseline.planned,
          baselineCommitted: baseline.committed,
          baselineInvoiced: baseline.invoiced,
          baselinePaid: baseline.paid,
          baselineTotal: baseTotal,
          delta: scenTotal - baseTotal,
        };
      });

      const summary = aggregateCOS(scenarioLines);

      // § 3.3: lines with a blank invoice date are flagged, never bucketed by
      // another date. Surface the flag so the UI can prompt for the invoice date.
      const missingInvoiceDate = Array.from(new Set([...baselineResult.missingInvoiceDate, ...scenarioResult.missingInvoiceDate]));
      res.json({ monthly: monthlyData, summary, lineCount: scenarioLines.length, missingInvoiceDate });
    } catch (err: any) {
      console.error('[COS Control Scenario Monthly]', err);
      throw err;
    }
  });

  app.get("/api/cos-control/tracker", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const [legacyExp, legacyInf] = await Promise.all([
        getCanonicalAllCurrentCostLines(),
        storage.getAllProgramInflows(),
      ]);
      const mergedData = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const allExpenses = mergedData.expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const monthMap = new Map<string, { planned: number; realised: number; budget: number }>();

      for (const e of items) {
        const actualAmt = parseFloat(e.expenseActualTotal || '0');
        const budgetAmt = parseFloat(e.budgetTotal || '0');

        const { date: cosDate } = getCosEffectiveDateAndSource(e);
        if (!cosDate && actualAmt === 0 && budgetAmt === 0) continue;

        let monthKey = '';
        if (cosDate) {
          const dateMatch = String(cosDate).match(/^(\d{4})-(\d{2})/);
          if (dateMatch) {
            monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
          }
        }
        if (!monthKey && actualAmt === 0 && budgetAmt === 0) continue;
        if (!monthKey) monthKey = 'undated';

        if (!monthMap.has(monthKey)) {
          monthMap.set(monthKey, { planned: 0, realised: 0, budget: 0 });
        }
        const bucket = monthMap.get(monthKey)!;

        if (actualAmt !== 0) {
          bucket.planned += actualAmt;

          const _nw = new Date();
          const _cmk = `${_nw.getFullYear()}-${String(_nw.getMonth() + 1).padStart(2, '0')}`;
          if (isEffectivelyRealisedLocal(e, monthKey, _cmk)) {
            bucket.realised += actualAmt;
          }
        }

        if (budgetAmt !== 0) {
          bucket.budget += budgetAmt;
        }
      }

      const months = Array.from(monthMap.entries())
        .filter(([k]) => k !== 'undated')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          planned: data.planned,
          realised: data.realised,
          outstanding: data.planned - data.realised,
          budget: data.budget,
        }));

      const undated = monthMap.get('undated');

      const totals = {
        planned: months.reduce((s, m) => s + m.planned, 0) + (undated?.planned || 0),
        realised: months.reduce((s, m) => s + m.realised, 0) + (undated?.realised || 0),
        outstanding: 0,
        budget: months.reduce((s, m) => s + m.budget, 0) + (undated?.budget || 0),
      };
      totals.outstanding = totals.planned - totals.realised;

      res.json({ months, totals, lineCount: items.length });
    } catch (err: any) {
      console.error('[COS Tracker]', err);
      throw err;
    }
  });

  app.get("/api/cashflow-tracker", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
    try {
      const [legacyExpCF, legacyInflowsCF, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        getCanonicalAllCurrentCostLines(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedCF = await getMergedExpensesAndInflows(legacyExpCF, legacyInflowsCF);
      const allInflows = resolveInflowEffectiveDates(mergedCF.inflows, allTaskLinks, allOpTasks, allPlanTasks);
      const items = mergedCF.expenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const weekMap = new Map<string, {
        inflows: number; confirmedInflows: number;
        outflows: number; confirmedOutflows: number;
        invoicedPayments: number;
      }>();

      function getWeekStart(dateStr: string): string | null {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
        return monday.toISOString().split('T')[0];
      }

      for (const e of items) {
        const amt = parseFloat(e.expenseActualTotal || '0');
        if (amt === 0) continue;

        const payDate = e.expensePaymentDate || e.forecastPaymentDate;
        if (!payDate) continue;
        const wk = getWeekStart(payDate);
        if (!wk) continue;

        if (!weekMap.has(wk)) weekMap.set(wk, { inflows: 0, confirmedInflows: 0, outflows: 0, confirmedOutflows: 0, invoicedPayments: 0 });
        const bucket = weekMap.get(wk)!;
        const isConfirmedOutflow = e.paymentDateFontColor === 'black';
        if (isConfirmedOutflow) {
          bucket.confirmedOutflows += amt;
        } else {
          bucket.outflows += amt;
        }

        const _nw2 = new Date();
        const _cmk2 = `${_nw2.getFullYear()}-${String(_nw2.getMonth() + 1).padStart(2, '0')}`;
        const _wkMonth = wk.substring(0, 7);
        if (isEffectivelyRealisedLocal(e, _wkMonth, _cmk2)) {
          bucket.invoicedPayments += amt;
        }
      }

      for (const inf of allInflows) {
        const amt = parseFloat(inf.milestoneAmount || '0');
        if (amt === 0) continue;

        const dateStr = inf.paymentReceivedDate || (inf as any).effectiveDate || inf.plannedPaymentDate;
        if (!dateStr) continue;
        const wk = getWeekStart(dateStr);
        if (!wk) continue;

        if (!weekMap.has(wk)) weekMap.set(wk, { inflows: 0, confirmedInflows: 0, outflows: 0, confirmedOutflows: 0, invoicedPayments: 0 });
        const bucket = weekMap.get(wk)!;
        const isConfirmedInflow = !!inf.paymentReceivedDate;
        if (isConfirmedInflow) {
          bucket.confirmedInflows += amt;
        } else {
          bucket.inflows += amt;
        }
      }

      const weeks = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, data]) => ({
          weekStart,
          inflows: data.inflows,
          confirmedInflows: data.confirmedInflows,
          outflows: data.outflows,
          confirmedOutflows: data.confirmedOutflows,
          cashflow: (data.inflows + data.confirmedInflows) - (data.outflows + data.confirmedOutflows),
          invoicedPayments: data.invoicedPayments,
        }));

      const totals = {
        inflows: weeks.reduce((s, w) => s + w.inflows, 0),
        confirmedInflows: weeks.reduce((s, w) => s + w.confirmedInflows, 0),
        outflows: weeks.reduce((s, w) => s + w.outflows, 0),
        confirmedOutflows: weeks.reduce((s, w) => s + w.confirmedOutflows, 0),
        cashflow: 0,
        invoicedPayments: weeks.reduce((s, w) => s + w.invoicedPayments, 0),
      };
      totals.cashflow = (totals.inflows + totals.confirmedInflows) - (totals.outflows + totals.confirmedOutflows);

      res.json({ weeks, totals });
    } catch (err: any) {
      console.error('[Cashflow Tracker]', err);
      throw err;
    }
  });

  app.get("/api/cos-control/scenario-invoices", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const search = (req.query.search as string || '').toLowerCase();
      const project = req.query.project as string || '';
      const state = req.query.state as string || '';

      const legacyExpSI = await getCanonicalAllCurrentCostLines();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSI, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const invoiceMap = new Map<string, any>();

      for (const e of items) {
        const amount = Math.abs(recognitionActualAmount(e));
        if (amount === 0) continue;

        const lineState = e.computedState || classifyExpenseState(e);

        const entityKey = `expense_line::${e.id}`;
        const effectiveInvoiceDate = overrideMap[entityKey]?.['invoice_date'] || e.expenseInvoicedDate;
        const effectivePaymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
        const effectiveForecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;

        const cosDateStr = effectivePaymentDate || effectiveForecastDate || effectiveInvoiceDate;
        let monthBucket = '';
        if (cosDateStr) {
          const d = new Date(cosDateStr);
          if (!isNaN(d.getTime())) {
            monthBucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          }
        }

        const groupKey = e.expenseInvoiceNumber || `line_${e.id}`;

        if (!invoiceMap.has(groupKey)) {
          invoiceMap.set(groupKey, {
            id: e.id,
            invoiceNumber: e.expenseInvoiceNumber || null,
            supplierName: e.supplierName || null,
            projects: [e.projectName],
            invoicedDate: effectiveInvoiceDate,
            paymentDate: effectivePaymentDate,
            forecastPaymentDate: effectiveForecastDate,
            amount,
            state: lineState,
            monthBucket,
            poNumber: e.expensePoNumber,
            category: e.expenseCategory,
            lineItem: e.expenseLineItem,
            confidence: scoreExpenseConfidence(e),
            lineCount: 1,
            originalInvoicedDate: e.expenseInvoicedDate,
            originalPaymentDate: e.expensePaymentDate,
          });
        } else {
          const existing = invoiceMap.get(groupKey)!;
          existing.amount += amount;
          existing.lineCount++;
          if (!existing.projects.includes(e.projectName)) existing.projects.push(e.projectName);
        }
      }

      let invoices = Array.from(invoiceMap.values());

      if (search) {
        invoices = invoices.filter(inv =>
          (inv.invoiceNumber || '').toLowerCase().includes(search) ||
          (inv.supplierName || '').toLowerCase().includes(search) ||
          (inv.poNumber || '').toLowerCase().includes(search) ||
          inv.projects.some((p: string) => p.toLowerCase().includes(search))
        );
      }
      if (project) invoices = invoices.filter(inv => inv.projects.includes(project));
      if (state) invoices = invoices.filter(inv => inv.state === state);

      invoices.sort((a, b) => b.amount - a.amount);

      res.json({ invoices, total: invoices.length });
    } catch (err: any) {
      console.error('[COS Control Scenario Invoices]', err);
      throw err;
    }
  });

  app.get("/api/cos-control/scenario-lines", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const search = (req.query.search as string || '').toLowerCase();
      const project = req.query.project as string || '';
      const state = req.query.state as string || '';

      const legacyExpSL = await getCanonicalAllCurrentCostLines();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSL, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      let lines = items.map((e: any) => {
        const amount = Math.abs(recognitionActualAmount(e));
        const lineState = e.computedState || classifyExpenseState(e);

        const entityKey = `expense_line::${e.id}`;
        const effectiveInvoiceDate = overrideMap[entityKey]?.['invoice_date'] || e.expenseInvoicedDate;
        const effectivePaymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
        const effectiveForecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;

        const cosDateStr = effectivePaymentDate || effectiveForecastDate || effectiveInvoiceDate;
        let monthBucket = '';
        if (cosDateStr) {
          const d = new Date(cosDateStr);
          if (!isNaN(d.getTime())) {
            monthBucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          }
        }

        return {
          id: e.id,
          hash: e.expenseLineHash,
          projectName: e.projectName,
          category: e.expenseCategory,
          lineItem: e.expenseLineItem,
          amount,
          state: lineState,
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          invoicedDate: effectiveInvoiceDate,
          paymentDate: effectivePaymentDate,
          forecastPaymentDate: effectiveForecastDate,
          supplierName: e.supplierName,
          monthBucket,
          confidence: scoreExpenseConfidence(e),
          originalInvoicedDate: e.expenseInvoicedDate,
          originalPaymentDate: e.expensePaymentDate,
        };
      }).filter((l: any) => l.amount > 0);

      if (search) {
        lines = lines.filter((l: any) =>
          (l.invoiceNumber || '').toLowerCase().includes(search) ||
          (l.poNumber || '').toLowerCase().includes(search) ||
          (l.projectName || '').toLowerCase().includes(search) ||
          (l.supplierName || '').toLowerCase().includes(search) ||
          (l.lineItem || '').toLowerCase().includes(search)
        );
      }
      if (project) lines = lines.filter((l: any) => l.projectName === project);
      if (state) lines = lines.filter((l: any) => l.state === state);

      lines.sort((a: any, b: any) => b.amount - a.amount);

      res.json({ lines, total: lines.length });
    } catch (err: any) {
      console.error('[COS Control Scenario Lines]', err);
      throw err;
    }
  });

  app.get("/api/cos-control/scenario-impact", requireAuth, requirePermission("cos_control", "view"), async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      if (!scenarioId) return res.json({ shifts: [], cashflowDelta: [] });

      const legacyExpSI2 = await getCanonicalAllCurrentCostLines();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSI2, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);
      const overrides: any[] = [];
      const overrideMap = new Map();

      const shifts: any[] = [];
      for (const ov of overrides) {
        if (ov.entityType === 'expense_line') {
          const expense = items.find((e: any) => String(e.id) === ov.entityId);
          if (expense) {
            const amount = Math.abs(parseFloat(expense.expenseActualTotal || expense.budgetTotal || '0'));
            const origDate = ov.originalDate || expense.expensePaymentDate || expense.computedForecastPaymentDate;
            const origMonth = origDate ? new Date(origDate).toISOString().slice(0, 7) : 'Unknown';
            const newMonth = new Date(ov.overrideDate).toISOString().slice(0, 7);
            if (origMonth !== newMonth) {
              shifts.push({
                entityId: ov.entityId,
                description: expense.expenseLineItem || expense.expenseInvoiceNumber || `Line #${expense.id}`,
                fromMonth: origMonth,
                toMonth: newMonth,
                amount,
              });
            }
          }
        }
      }

      shifts.sort((a, b) => b.amount - a.amount);

      res.json({ shifts: shifts.slice(0, 10), totalShifts: shifts.length });
    } catch (err: any) {
      throw err;
    }
  });

  // ============ SCENARIO-AWARE CASHFLOW FORECAST API ============

  app.get("/api/cashflow-forecast/scenario-weekly", requireAuth, requirePermission("cashflow_forecast", "view"), async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const projectFilter = req.query.project as string || '';

      const legacyExpSW = await getCanonicalAllCurrentCostLines();
      const legacyInfSW = await storage.getAllProgramInflows();
      const [allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedSW = await getMergedExpensesAndInflows(legacyExpSW, legacyInfSW);
      let allExpenses = mergedSW.expenses;
      let allInflows = resolveInflowEffectiveDates(mergedSW.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      if (projectFilter) {
        allExpenses = allExpenses.filter((e: any) => e.projectName === projectFilter);
        allInflows = allInflows.filter((i: any) => i.projectName === projectFilter);
      }

      const expenseItems = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const buildCashflowLines = (expenses: any[], inflows: any[], overrideMap: any = {}): { inflowLines: CashflowLineItem[]; outflowLines: CashflowLineItem[] } => {
        const outflowLines: CashflowLineItem[] = expenses.map((e: any) => {
          const amount = Math.abs(cashOutflowAmount(e));
          if (amount === 0) return null;

          const entityKey = `expense_line::${e.id}`;
          const paymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
          const forecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;

          return {
            id: e.id,
            projectName: e.projectName,
            type: 'outflow' as const,
            amount,
            actualDate: paymentDate && !overrideMap[entityKey]?.['payment_date'] ? e.expensePaymentDate : null,
            forecastDate: paymentDate || forecastDate || null,
            confidence: scoreExpenseConfidence(e) as 'High' | 'Medium' | 'Low',
            assumptionDriver: getAssumptionDriver(e, 30),
            description: e.expenseLineItem || e.expenseCategory || 'Expense',
            invoiceNumber: e.expenseInvoiceNumber,
            poNumber: e.expensePoNumber,
            category: e.expenseCategory,
            supplierName: e.supplierName,
          };
        }).filter(Boolean) as CashflowLineItem[];

        const inflowLines: CashflowLineItem[] = inflows.map((inf: any) => {
          const amount = Math.abs(parseFloat(inf.milestoneAmount || '0'));
          if (amount === 0) return null;

          const entityKey = `inflow_line::${inf.id}`;
          const scenarioReceiptDate = overrideMap[entityKey]?.['receipt_date'];
          const receiptDate = scenarioReceiptDate || inf.paymentReceivedDate;
          const forecastDate = scenarioReceiptDate || inf.effectiveDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate;

          return {
            id: inf.id,
            projectName: inf.projectName,
            type: 'inflow' as const,
            amount,
            actualDate: receiptDate && !scenarioReceiptDate ? inf.paymentReceivedDate : null,
            forecastDate: forecastDate || null,
            confidence: scoreInflowConfidence(inf) as 'High' | 'Medium' | 'Low',
            assumptionDriver: getAssumptionDriver(inf, 30),
            description: inf.milestoneName || `Milestone ${inf.milestoneNo || ''}`,
            invoiceNumber: inf.milestoneInvoiceNumber,
            poNumber: null,
            category: 'Revenue',
            supplierName: null,
          };
        }).filter(Boolean) as CashflowLineItem[];

        return { inflowLines, outflowLines };
      };

      const manualBalances = await storage.getAllCashflowWeeklyManual();
      const openingBalance = manualBalances.length > 0 ? parseFloat(manualBalances[0].openingBalance || '0') : 0;

      const baseline = buildCashflowLines(expenseItems, allInflows);
      const baselineWeeks = computeWeeklyCashflow(baseline.inflowLines, baseline.outflowLines, '2025-09-01', 52, openingBalance);

      let scenarioWeeks = baselineWeeks;
      if (scenarioId) {
        const overrideMap = new Map();
        const scenarioData = buildCashflowLines(expenseItems, allInflows, overrideMap);
        scenarioWeeks = computeWeeklyCashflow(scenarioData.inflowLines, scenarioData.outflowLines, '2025-09-01', 52, openingBalance);
      }

      const weeklyData = scenarioWeeks.map((sw, i) => {
        const bw = baselineWeeks[i];
        return {
          ...sw,
          baselineClosingBalance: bw?.closingBalance ?? 0,
          baselineInflowsTotal: (bw?.inflowsActual ?? 0) + (bw?.inflowsForecast ?? 0),
          baselineOutflowsTotal: (bw?.outflowsActual ?? 0) + (bw?.outflowsForecast ?? 0),
          deltaInflows: ((sw.inflowsActual + sw.inflowsForecast) - ((bw?.inflowsActual ?? 0) + (bw?.inflowsForecast ?? 0))),
          deltaOutflows: ((sw.outflowsActual + sw.outflowsForecast) - ((bw?.outflowsActual ?? 0) + (bw?.outflowsForecast ?? 0))),
          deltaClosingBalance: sw.closingBalance - (bw?.closingBalance ?? 0),
        };
      });

      res.json({ weeks: weeklyData });
    } catch (err: any) {
      console.error('[Cashflow Forecast Scenario Weekly]', err);
      throw err;
    }
  });

  app.get("/api/cashflow-forecast/scenario-week-detail", requireAuth, requirePermission("cashflow_forecast", "view"), async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const weekStart = req.query.weekStart as string;
      const weekEnd = req.query.weekEnd as string;

      if (!weekStart || !weekEnd) return res.status(400).json({ error: "weekStart and weekEnd required" });

      const [legacyExpSWD, legacyInfSWD, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        getCanonicalAllCurrentCostLines(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedSWD = await getMergedExpensesAndInflows(legacyExpSWD, legacyInfSWD);
      const allInflows = resolveInflowEffectiveDates(mergedSWD.inflows, allTaskLinks, allOpTasks, allPlanTasks);
      const expenseItems = mergedSWD.expenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const lines: any[] = [];

      for (const e of expenseItems) {
        const amount = Math.abs(cashOutflowAmount(e));
        if (amount === 0) continue;

        const entityKey = `expense_line::${e.id}`;
        const paymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
        const forecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;
        const effectiveDate = paymentDate || forecastDate;
        if (!effectiveDate) continue;

        const d = new Date(effectiveDate);
        if (isNaN(d.getTime())) continue;
        const ws = new Date(weekStart); ws.setHours(0,0,0,0);
        const we = new Date(weekEnd); we.setHours(0,0,0,0);
        d.setHours(0,0,0,0);
        if (d < ws || d > we) continue;

        lines.push({
          id: e.id,
          type: 'outflow',
          projectName: e.projectName,
          description: e.expenseLineItem || e.expenseCategory || 'Expense',
          amount,
          actualDate: e.expensePaymentDate,
          forecastDate: forecastDate,
          effectiveDate,
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          category: e.expenseCategory,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          hasOverride: !!overrideMap[entityKey],
          originalDate: e.expensePaymentDate || e.computedForecastPaymentDate || e.forecastPaymentDate,
        });
      }

      for (const inf of allInflows) {
        const amount = Math.abs(parseFloat(inf.milestoneAmount || '0'));
        if (amount === 0) continue;

        const entityKey = `inflow_line::${inf.id}`;
        const scenarioReceiptDate = overrideMap[entityKey]?.['receipt_date'];
        const receiptDate = scenarioReceiptDate || inf.paymentReceivedDate;
        const forecastDate = scenarioReceiptDate || inf.effectiveDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate;
        const effectiveDate = receiptDate || forecastDate;
        if (!effectiveDate) continue;

        const d = new Date(effectiveDate);
        if (isNaN(d.getTime())) continue;
        const ws = new Date(weekStart); ws.setHours(0,0,0,0);
        const we = new Date(weekEnd); we.setHours(0,0,0,0);
        d.setHours(0,0,0,0);
        if (d < ws || d > we) continue;

        lines.push({
          id: inf.id,
          type: 'inflow',
          projectName: inf.projectName,
          description: inf.milestoneName || `Milestone ${inf.milestoneNo || ''}`,
          amount,
          actualDate: inf.paymentReceivedDate,
          forecastDate: forecastDate,
          effectiveDate,
          invoiceNumber: inf.milestoneInvoiceNumber,
          poNumber: null,
          category: 'Revenue',
          supplierName: null,
          confidence: scoreInflowConfidence(inf),
          hasOverride: !!overrideMap[entityKey] || (inf.effectiveDate !== inf.paymentReceivedDate && inf.effectiveDate !== inf.computedForecastReceiptDate),
          originalDate: inf.paymentReceivedDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate,
        });
      }

      lines.sort((a, b) => b.amount - a.amount);

      const inflowTotal = lines.filter(l => l.type === 'inflow').reduce((s, l) => s + l.amount, 0);
      const outflowTotal = lines.filter(l => l.type === 'outflow').reduce((s, l) => s + l.amount, 0);

      res.json({
        lines,
        total: lines.length,
        inflowTotal,
        outflowTotal,
        inflowCount: lines.filter(l => l.type === 'inflow').length,
        outflowCount: lines.filter(l => l.type === 'outflow').length,
      });
    } catch (err: any) {
      console.error('[Cashflow Forecast Scenario Week Detail]', err);
      throw err;
    }
  });

  // ============ SCENARIO-AWARE PLANNING API ============

  app.get("/api/planning-board/scenario-projects", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const projects = await db.select().from(projectInfo);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const projectData = projects.map((p: any) => {
        const entityKey = `project_keydate::${p.projectName}`;
        const effectiveConstructionStart = overrideMap[entityKey]?.['construction_start'] || p.constructionStartDate;
        const effectiveCommissioning = overrideMap[entityKey]?.['commissioning_date'] || p.commissioningDate;
        const effectiveOmHandover = overrideMap[entityKey]?.['om_handover_date'] || p.omHandoverDate;
        const effectiveClientHandover = overrideMap[entityKey]?.['client_handover_date'] || p.clientHandoverDate;

        return {
          projectName: p.projectName,
          pm: p.pm,
          phase: p.phase,
          sizeKwp: p.sizeKwp,
          constructionStartDate: effectiveConstructionStart,
          commissioningDate: effectiveCommissioning,
          omHandoverDate: effectiveOmHandover,
          clientHandoverDate: effectiveClientHandover,
          originalConstructionStart: p.constructionStartDate,
          originalCommissioning: p.commissioningDate,
          originalOmHandover: p.omHandoverDate,
          originalClientHandover: p.clientHandoverDate,
          hasOverride: !!overrideMap[entityKey],
          isActive: p.isActive,
        };
      });

      res.json({ projects: projectData });
    } catch (err: any) {
      throw err;
    }
  });

  app.get("/api/planning-board/scenario-capacity", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const resourceType = (req.query.resourceType as string) || 'PM';

      const projects = await db.select().from(projectInfo);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const weeklyDemand = new Map<string, { total: number; projects: string[] }>();
      const startDate = new Date('2025-09-01');

      for (let w = 0; w < 52; w++) {
        const weekStart = new Date(startDate);
        weekStart.setDate(startDate.getDate() + w * 7);
        const weekKey = weekStart.toISOString().split('T')[0];
        weeklyDemand.set(weekKey, { total: 0, projects: [] });
      }

      for (const p of projects) {
        if (!p.isActive) continue;

        const entityKey = `project_keydate::${p.projectName}`;
        const startStr = overrideMap[entityKey]?.['construction_start'] || p.constructionStartDate;
        const endStr = overrideMap[entityKey]?.['client_handover_date'] || p.clientHandoverDate || overrideMap[entityKey]?.['commissioning_date'] || p.commissioningDate;

        if (!startStr || !endStr) continue;

        const projStart = new Date(startStr);
        const projEnd = new Date(endStr);
        if (isNaN(projStart.getTime()) || isNaN(projEnd.getTime())) continue;

        for (const [weekKey, demand] of weeklyDemand.entries()) {
          const weekDate = new Date(weekKey);
          const weekEnd = new Date(weekDate);
          weekEnd.setDate(weekDate.getDate() + 6);

          if (projStart <= weekEnd && projEnd >= weekDate) {
            if (resourceType === 'PM') {
              const pm = p.pm || 'Unassigned';
              demand.total += 1;
              demand.projects.push(p.projectName);
            } else if (resourceType === 'Installer') {
              const sizeKwp = parseFloat(p.sizeKwp || '0');
              const durationWeeks = Math.max(1, Math.ceil((projEnd.getTime() - projStart.getTime()) / (7 * 86400000)));
              const weeklyKwp = sizeKwp / durationWeeks;
              demand.total += weeklyKwp;
              demand.projects.push(p.projectName);
            }
          }
        }
      }

      const capacityData = Array.from(weeklyDemand.entries()).map(([weekKey, d]) => ({
        weekStart: weekKey,
        demand: d.total,
        projects: d.projects,
        projectCount: d.projects.length,
        capacity: resourceType === 'PM' ? 5 : 500,
        overCapacity: resourceType === 'PM' ? d.total > 5 : d.total > 500,
      }));

      const clashes = capacityData
        .filter(c => c.overCapacity)
        .map(c => ({
          weekStart: c.weekStart,
          demand: c.demand,
          capacity: c.capacity,
          excess: c.demand - c.capacity,
          projects: c.projects,
          message: `${resourceType} over capacity week of ${c.weekStart}: ${c.projects.join(', ')}`,
        }));

      res.json({ capacity: capacityData, clashes, resourceType });
    } catch (err: any) {
      throw err;
    }
  });
}
