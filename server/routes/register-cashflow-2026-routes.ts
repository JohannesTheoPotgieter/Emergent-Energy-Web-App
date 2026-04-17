import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth as sharedRequireAuth } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import {
  isDateConfirmedCheck,
  getMergedExpensesAndInflows,
  resolveInflowEffectiveDates,
} from "../lib/cashflow-helpers";
import { db } from "../db";
import { quickbooksInvoiceLinks, quickbooksDocuments } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

const requireAuth = sharedRequireAuth;

export function registerCashflow2026Routes(app: Express) {

  // ==================== CASHFLOW 2026 WEEKLY VIEW ====================

  app.get("/api/cashflow-2026", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectFilter = req.query.project ? String(req.query.project) : null;

      const [legacyExp, legacyInf, manualBalances, opexBudgets, opexWeeklyOverrides, availPaymentOverrides, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllCashflowWeeklyManual(),
        storage.getAllOpexBudgetMonthly(),
        storage.getAllOpexWeeklyManual(),
        storage.getAllAvailablePaymentOverrides(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedData = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const allExpenses = mergedData.expenses;
      const allInflows = resolveInflowEffectiveDates(mergedData.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const manualMap = new Map(manualBalances.map((m: any) => [m.weekStartDate, parseFloat(m.openingBalance || "0")]));
      const opexMonthlyMap = new Map(opexBudgets.map((o: any) => [o.monthKey, parseFloat(o.amount || "0")]));
      const opexWeeklyMap = new Map(opexWeeklyOverrides.map((o: any) => [o.weekStartDate, parseFloat(o.opexAmount || "0")]));
      const availPayMap = new Map(availPaymentOverrides.map((o: any) => [o.weekStartDate, { value: parseFloat(o.overrideValue || "0"), reason: o.reason }]));

      const fyStart = new Date(Date.UTC(2025, 8, 1));
      const fyEnd = new Date(Date.UTC(2026, 7, 31));

      const weeksInMonth = new Map<string, number>();
      const tempDate = new Date(fyStart);
      while (tempDate <= fyEnd) {
        const mk = `${tempDate.getUTCFullYear()}-${String(tempDate.getUTCMonth() + 1).padStart(2, '0')}`;
        weeksInMonth.set(mk, (weeksInMonth.get(mk) || 0) + 1);
        tempDate.setUTCDate(tempDate.getUTCDate() + 7);
      }

      const weeks: any[] = [];
      const cursor = new Date(fyStart);
      let runningBalance = 0;

      while (cursor <= fyEnd) {
        const weekStart = cursor.toISOString().split('T')[0];
        const weekEndDate = new Date(cursor);
        weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
        const weekEnd = weekEndDate.toISOString().split('T')[0];

        let projectInflowsSum = 0;
        for (const inflow of allInflows) {
          if (projectFilter && inflow.projectName !== projectFilter) continue;
          const d = inflow.effectiveDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (d >= weekStart && d < weekEnd && inflow.milestoneAmount) {
            projectInflowsSum += parseFloat(inflow.milestoneAmount) || 0;
          }
        }

        let projectOutflowsSum = 0;
        const outflowByStatus = { outOfBank: 0, outstanding: 0, risk: 0, planned: 0 };
        for (const expense of allExpenses) {
          // Bottom-up: only aggregate leaf-node (item) rows, matching project-detail level logic
          if (expense.rowType !== 'item') continue;
          if (projectFilter && expense.projectName !== projectFilter) continue;
          // Use effective payment date: actual, then computed forecast, then forecast, then invoice date
          const d = expense.expensePaymentDate || (expense as any).computedForecastPaymentDate || (expense as any).forecastPaymentDate || (expense as any).expenseInvoicedDate || null;
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          const amt = parseFloat((expense as any).quotedTotal || expense.expenseActualTotal || (expense as any).budgetTotal || '0') || 0;
          if (d >= weekStart && d < weekEnd && amt > 0) {
            projectOutflowsSum += amt;
            // Classify payment status
            const hasInvoice = !!(expense.expenseInvoiceNumber && String(expense.expenseInvoiceNumber).trim());
            const hasPayDate = !!(expense.expensePaymentDate && String(expense.expensePaymentDate).trim());
            const payDateBlack = hasPayDate && isDateConfirmedCheck((expense as any).paymentDateConfirmed, (expense as any).paymentDateFontColor);
            if (payDateBlack && hasInvoice) {
              outflowByStatus.outOfBank += amt;
            } else if (payDateBlack && !hasInvoice) {
              outflowByStatus.risk += amt;
            } else if (hasPayDate && !payDateBlack && hasInvoice) {
              outflowByStatus.outstanding += amt;
            } else {
              outflowByStatus.planned += amt;
            }
          }
        }

        const computedOpening = runningBalance;
        const hasManualOverride = !projectFilter && manualMap.has(weekStart);
        const openingBalance = hasManualOverride ? manualMap.get(weekStart)! : computedOpening;
        const balanceDelta = hasManualOverride ? openingBalance - computedOpening : 0;

        const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
        const monthlyOpex = opexMonthlyMap.get(mk) || 0;
        const weeksCount = weeksInMonth.get(mk) || 1;
        const computedOpex = monthlyOpex / weeksCount;
        const hasOpexOverride = opexWeeklyMap.has(weekStart);
        const opexOutflows = projectFilter ? 0 : (hasOpexOverride ? opexWeeklyMap.get(weekStart)! : computedOpex);

        const totalOutflows = opexOutflows + projectOutflowsSum;
        const closingBalance = openingBalance + projectInflowsSum - totalOutflows;
        const computedAvailablePayment = openingBalance + projectInflowsSum - totalOutflows;
        const hasAvailPayOverride = availPayMap.has(weekStart);
        const availPayOverride = availPayMap.get(weekStart);
        const availablePayment = hasAvailPayOverride ? availPayOverride!.value : computedAvailablePayment;
        const availPayReason = hasAvailPayOverride ? availPayOverride!.reason : null;

        weeks.push({
          weekStart,
          weekEnd,
          projectInflows: projectInflowsSum,
          projectOutflows: projectOutflowsSum,
          outflowByStatus,
          openingBalance,
          computedOpening,
          hasManualOverride,
          balanceDelta,
          opexOutflows,
          computedOpex,
          hasOpexOverride,
          closingBalance,
          availablePayment,
          computedAvailablePayment,
          hasAvailPayOverride,
          availPayReason,
        });

        runningBalance = closingBalance;
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }

      res.json(weeks);
    } catch (error) {
      console.error("Cashflow 2026 error:", error);
      res.status(500).json({ error: "Failed to fetch cashflow 2026 data", message: "Failed to fetch cashflow 2026 data" });
    }
  });

  // ==================== CASHFLOW 2026 DETAIL ====================

  app.get("/api/cashflow-2026/detail", requireAuth, async (req: Request, res: Response) => {
    try {
      const weekStart = String(req.query.week || "");
      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return res.status(400).json({ error: "Invalid week parameter", message: "Provide ?week=YYYY-MM-DD" });
      }
      const projectFilter = req.query.project ? String(req.query.project) : null;

      const [y, m, d] = weekStart.split('-').map(Number);
      const wsDate = new Date(Date.UTC(y, m - 1, d));
      wsDate.setUTCDate(wsDate.getUTCDate() + 7);
      const weekEnd = wsDate.toISOString().split('T')[0];

      const [legacyExp, legacyInf, allTaskLinks, allOpTasks, allPlanTasks, qbLinks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
        db
          .select({
            id: quickbooksInvoiceLinks.id,
            appEntityType: quickbooksInvoiceLinks.appEntityType,
            appEntityId: quickbooksInvoiceLinks.appEntityId,
            qbEntityType: quickbooksInvoiceLinks.qbEntityType,
            qbEntityId: quickbooksInvoiceLinks.qbEntityId,
            qbDocNumber: quickbooksInvoiceLinks.qbDocNumber,
            qbAmount: quickbooksInvoiceLinks.qbAmount,
          })
          .from(quickbooksInvoiceLinks)
          .where(isNull(quickbooksInvoiceLinks.deletedAt)),
      ]);
      const mergedDetail = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const resolvedInflows = resolveInflowEffectiveDates(mergedDetail.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      // Build lookup maps: QB links by app entity id for fast join on row render.
      const qbByCostLine = new Map<number, typeof qbLinks[number]>();
      const qbByRevenueLine = new Map<number, typeof qbLinks[number]>();
      for (const l of qbLinks) {
        if (l.appEntityType === "cost_line") qbByCostLine.set(l.appEntityId, l);
        else if (l.appEntityType === "revenue_line") qbByRevenueLine.set(l.appEntityId, l);
      }

      const outflows = mergedDetail.expenses
        .filter((e: any) => {
          if (projectFilter && e.projectName !== projectFilter) return false;
          const pd = e.expensePaymentDate;
          if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return false;
          return pd >= weekStart && pd < weekEnd;
        })
        .map((e: any) => {
          const hasInvoice = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
          const hasPayDate = !!(e.expensePaymentDate && String(e.expensePaymentDate).trim());
          const payDateBlack = hasPayDate && isDateConfirmedCheck(e.paymentDateConfirmed, e.paymentDateFontColor);
          let paymentStatus: string;
          if (payDateBlack && hasInvoice) {
            paymentStatus = 'Out of Bank';
          } else if (payDateBlack && !hasInvoice) {
            paymentStatus = 'Risk';
          } else if (hasPayDate && !payDateBlack && hasInvoice) {
            paymentStatus = 'Outstanding';
          } else {
            paymentStatus = 'Planned';
          }
          // QB paid status — if this app cost line is linked to a QB bill,
          // surface the QB doc number + amount so the cashflow row shows
          // "QB Confirmed" with the reference. Otherwise mark as unlinked.
          const costLineId = Number(e.costLineId ?? e.normalizedCostLineId ?? e.id);
          const qbLink = Number.isFinite(costLineId) ? qbByCostLine.get(costLineId) : undefined;
          const qbStatus = qbLink ? "confirmed" : "unlinked";
          const qbDocNumber = qbLink?.qbDocNumber ?? null;
          const qbAmount = qbLink?.qbAmount != null ? parseFloat(qbLink.qbAmount as any) : null;

          return {
            projectName: e.projectName,
            expenseCategory: e.expenseCategory,
            expenseLineItem: e.expenseLineItem,
            expenseInvoiceNumber: e.expenseInvoiceNumber,
            expensePaymentDate: e.expensePaymentDate,
            expenseActualTotal: parseFloat(e.quotedTotal || e.expenseActualTotal || '0') || 0,
            paymentStatus,
            qbStatus,
            qbDocNumber,
            qbAmount,
          };
        });

      const inflows = resolvedInflows
        .filter((inf: any) => {
          if (projectFilter && inf.projectName !== projectFilter) return false;
          const pd = inf.effectiveDate;
          if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return false;
          return pd >= weekStart && pd < weekEnd;
        })
        .map((inf: any) => {
          let daysToReceipt: number | null = null;
          if (inf.invoiceRaisedDate && inf.paymentReceivedDate &&
              /^\d{4}-\d{2}-\d{2}$/.test(inf.invoiceRaisedDate) &&
              /^\d{4}-\d{2}-\d{2}$/.test(inf.paymentReceivedDate)) {
            const inv = new Date(inf.invoiceRaisedDate);
            const pay = new Date(inf.paymentReceivedDate);
            daysToReceipt = Math.round((pay.getTime() - inv.getTime()) / (1000 * 60 * 60 * 24));
          }
          // QB paid status — if this app revenue line is linked to a QB
          // invoice, surface the QB doc number + amount so the cashflow row
          // shows "QB Confirmed" with the reference. Otherwise mark as unlinked.
          const revenueLineId = Number(inf.revenueLineId ?? inf.normalizedRevenueLineId ?? inf.id);
          const qbLink = Number.isFinite(revenueLineId) ? qbByRevenueLine.get(revenueLineId) : undefined;
          const qbStatus = qbLink ? "confirmed" : "unlinked";
          const qbDocNumber = qbLink?.qbDocNumber ?? null;
          const qbAmount = qbLink?.qbAmount != null ? parseFloat(qbLink.qbAmount as any) : null;

          return {
            projectName: inf.projectName,
            milestoneName: inf.milestoneName,
            milestoneInvoiceNumber: inf.milestoneInvoiceNumber,
            paymentReceivedDate: inf.effectiveDate,
            milestoneAmount: inf.milestoneAmount ? parseFloat(inf.milestoneAmount) : 0,
            invoiceRaisedDate: inf.invoiceRaisedDate,
            daysToReceipt,
            isOverride: inf.effectiveDate !== inf.paymentReceivedDate,
            qbStatus,
            qbDocNumber,
            qbAmount,
          };
        });

      res.json({ outflows, inflows });
    } catch (error) {
      console.error("Cashflow 2026 detail error:", error);
      res.status(500).json({ error: "Failed to fetch cashflow detail", message: "Failed to fetch cashflow detail" });
    }
  });

  // ==================== MANUAL INPUT ENDPOINTS ====================

  app.post("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { weekStartDate, openingBalance, computedValue, clearForward } = req.body;
      if (!weekStartDate || openingBalance == null) {
        return res.status(400).json({ error: "weekStartDate and openingBalance required" });
      }

      const existingManuals = await storage.getAllCashflowWeeklyManual();
      const existing = existingManuals.find((m: any) => m.weekStartDate === weekStartDate);
      const previousValue = existing ? existing.openingBalance : null;
      const newVal = parseFloat(String(openingBalance));
      const compVal = computedValue != null ? parseFloat(String(computedValue)) : null;
      const delta = compVal != null ? newVal - compVal : null;

      const user = req.user as any;
      await storage.addBalanceHistory({
        weekStartDate,
        previousValue: previousValue || null,
        newValue: String(newVal),
        computedValue: compVal != null ? String(compVal) : null,
        delta: delta != null ? String(delta) : null,
        changedBy: user?.username || null,
      });

      const result = await storage.upsertCashflowWeeklyManual(weekStartDate, String(openingBalance));

      let clearedWeeks: string[] = [];
      if (clearForward) {
        const nextWeek = new Date(weekStartDate);
        nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];
        clearedWeeks = await storage.deleteAllCashflowWeeklyManualAfter(nextWeekStr);
      }

      logAuditFromReq(req, { entityType: "cashflow_balance", action: "update", entityId: weekStartDate, changesJson: { description: "Opening balance updated", weekStartDate, openingBalance, clearForward } });
      res.json({ ...result, clearedWeeks });
    } catch (error) {
      console.error("Opening balance save error:", error);
      res.status(500).json({ error: "Failed to save opening balance", message: "Failed to save opening balance" });
    }
  });

  app.get("/api/cashflow-2026/balance-history", requireAuth, async (req: Request, res: Response) => {
    try {
      const weekStart = req.query.week ? String(req.query.week) : null;
      if (weekStart) {
        const history = await storage.getBalanceHistory(weekStart);
        return res.json(history);
      }
      const allHistory = await storage.getAllBalanceHistory();
      res.json(allHistory);
    } catch (error) {
      console.error("Balance history error:", error);
      res.status(500).json({ error: "Failed to fetch balance history" });
    }
  });

  app.delete("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { weekStartDate } = req.body;
      if (!weekStartDate) {
        return res.status(400).json({ error: "weekStartDate required" });
      }
      const existingManuals = await storage.getAllCashflowWeeklyManual();
      const existing = existingManuals.find((m: any) => m.weekStartDate === weekStartDate);
      if (existing) {
        const user = req.user as any;
        await storage.addBalanceHistory({
          weekStartDate,
          previousValue: existing.openingBalance || null,
          newValue: "0",
          computedValue: null,
          delta: null,
          changedBy: user?.username || null,
        });
        await storage.deleteCashflowWeeklyManual(weekStartDate);
      }
      logAuditFromReq(req, { entityType: "cashflow_balance", action: "delete", entityId: weekStartDate, changesJson: { description: "Opening balance deleted", weekStartDate } });
      res.json({ ok: true });
    } catch (error) {
      console.error("Opening balance delete error:", error);
      res.status(500).json({ error: "Failed to delete opening balance" });
    }
  });

  app.post("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { monthKey, amount } = req.body;
      if (!monthKey || amount == null) {
        return res.status(400).json({ error: "monthKey and amount required" });
      }
      const result = await storage.upsertOpexBudgetMonthly(monthKey, String(amount));
      logAuditFromReq(req, { entityType: "opex_budget", action: "update", entityId: monthKey, changesJson: { description: "OPEX budget updated", monthKey, amount } });
      res.json(result);
    } catch (error) {
      console.error("OPEX budget save error:", error);
      res.status(500).json({ error: "Failed to save OPEX budget", message: "Failed to save OPEX budget" });
    }
  });

  app.get("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "view"), async (req: Request, res: Response) => {
    try {
      const entries = await storage.getAllOpexBudgetMonthly();
      res.json(entries);
    } catch (error) {
      console.error("OPEX budget fetch error:", error);
      res.status(500).json({ error: "Failed to fetch OPEX budgets", message: "Failed to fetch OPEX budgets" });
    }
  });

  app.post("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { weekStartDate, opexAmount } = req.body;
      if (!weekStartDate || opexAmount == null) {
        return res.status(400).json({ error: "weekStartDate and opexAmount required" });
      }
      const result = await storage.upsertOpexWeeklyManual(weekStartDate, String(opexAmount));
      logAuditFromReq(req, { entityType: "opex_weekly", action: "update", entityId: weekStartDate, changesJson: { description: "OPEX weekly override updated", weekStartDate, opexAmount } });
      res.json(result);
    } catch (error) {
      console.error("OPEX weekly save error:", error);
      res.status(500).json({ error: "Failed to save weekly OPEX" });
    }
  });

  app.delete("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { weekStartDate } = req.body;
      if (!weekStartDate) {
        return res.status(400).json({ error: "weekStartDate required" });
      }
      await storage.deleteOpexWeeklyManual(weekStartDate);
      logAuditFromReq(req, { entityType: "opex_weekly", action: "delete", entityId: weekStartDate, changesJson: { description: "OPEX weekly override deleted", weekStartDate } });
      res.json({ success: true });
    } catch (error) {
      console.error("OPEX weekly delete error:", error);
      res.status(500).json({ error: "Failed to delete weekly OPEX override" });
    }
  });

  app.post("/api/cashflow-2026/available-payment", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { weekStartDate, overrideValue, reason, computedValue } = req.body;
      if (!weekStartDate || overrideValue == null) {
        return res.status(400).json({ error: "weekStartDate and overrideValue required" });
      }

      const existingOverrides = await storage.getAllAvailablePaymentOverrides();
      const existing = existingOverrides.find((o: any) => o.weekStartDate === weekStartDate);
      const previousValue = existing ? existing.overrideValue : null;
      const newVal = parseFloat(String(overrideValue));
      const compVal = computedValue != null ? parseFloat(String(computedValue)) : null;

      const user = req.user as any;
      await storage.addAvailablePaymentHistory({
        weekStartDate,
        previousValue: previousValue || null,
        newValue: String(newVal),
        computedValue: compVal != null ? String(compVal) : null,
        reason: reason || null,
        changedBy: user?.username || user?.name || null,
      });

      const result = await storage.upsertAvailablePaymentOverride(
        weekStartDate,
        String(newVal),
        reason || null,
        user?.username || user?.name || null
      );

      logAuditFromReq(req, { entityType: "available_payment", action: "update", entityId: weekStartDate, changesJson: { description: "Available payment override updated", weekStartDate, overrideValue, reason } });
      res.json(result);
    } catch (error) {
      console.error("Available payment save error:", error);
      res.status(500).json({ error: "Failed to save available payment override" });
    }
  });

  app.delete("/api/cashflow-2026/available-payment", requireAuth, requirePermission("cashflow", "edit"), async (req: Request, res: Response) => {
    try {
      const { weekStartDate } = req.body;
      if (!weekStartDate) {
        return res.status(400).json({ error: "weekStartDate required" });
      }
      const existingOverrides = await storage.getAllAvailablePaymentOverrides();
      const existing = existingOverrides.find((o: any) => o.weekStartDate === weekStartDate);
      if (existing) {
        const user = req.user as any;
        await storage.addAvailablePaymentHistory({
          weekStartDate,
          previousValue: existing.overrideValue || null,
          newValue: "0",
          computedValue: null,
          reason: "Override cleared",
          changedBy: user?.username || user?.name || null,
        });
        await storage.deleteAvailablePaymentOverride(weekStartDate);
      }
      logAuditFromReq(req, { entityType: "available_payment", action: "delete", entityId: weekStartDate, changesJson: { description: "Available payment override deleted", weekStartDate } });
      res.json({ ok: true });
    } catch (error) {
      console.error("Available payment delete error:", error);
      res.status(500).json({ error: "Failed to delete available payment override" });
    }
  });

  app.get("/api/cashflow-2026/available-payment-history", requireAuth, requirePermission("cashflow", "view"), async (req: Request, res: Response) => {
    try {
      const weekStart = req.query.week ? String(req.query.week) : null;
      if (!weekStart) {
        return res.status(400).json({ error: "week query parameter required" });
      }
      const history = await storage.getAvailablePaymentHistory(weekStart);
      res.json(history);
    } catch (error) {
      console.error("Available payment history error:", error);
      res.status(500).json({ error: "Failed to fetch available payment history" });
    }
  });
}
