import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { requirePermission } from "../permission-middleware";
import { z } from "zod";
import { insertBudgetSchema, OVERRIDE_CATEGORIES, cosStatusOverrides, financialEditRequests, notifications, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import { recordOverride } from "../lib/audit/diff-engine";

const FINANCIAL_APPROVER_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER"];

function requireAdminOrFinancialEditor(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  if (role === "PROJECT_MANAGER_SITE" || role === "PROGRAM_MANAGER" || role === "PROGRAM_FINANCE_MANAGER" || role === "CONSTRUCTION_MANAGER") return next();
  res.status(403).json({ error: "admin_required", message: "Admin or financial editor access required", code: "ADMIN_REQUIRED" });
}

function isPmOnlyRole(role: string | undefined): boolean {
  return role === "PROJECT_MANAGER_SITE";
}

async function createPendingEditRequest(
  userId: number,
  projectName: string,
  editType: string,
  editTarget: string,
  editPayload: any,
  editSummary: string
) {
  const [saved] = await db.insert(financialEditRequests).values({
    projectName,
    requestedByUserId: userId,
    editType,
    editTarget,
    editPayload: typeof editPayload === "string" ? editPayload : JSON.stringify(editPayload),
    editSummary,
    isCriticalPath: false,
    affectsRevenue: editType.includes("revenue"),
    affectsExpenditure: editType.includes("expenditure"),
    affectsQuality: false,
    status: "pending",
  }).returning();

  const recipients = await db.select({ id: users.id }).from(users)
    .where(inArray(users.role, FINANCIAL_APPROVER_ROLES));
  const [requestor] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));

  for (const r of recipients) {
    if (r.id === userId) continue;
    await db.insert(notifications).values({
      recipientUserId: r.id,
      eventType: "financial.edit_request",
      title: `Edit Request: ${projectName}`,
      body: `${requestor?.name || "A PM"} submitted a ${editType} edit requiring approval. ${editSummary}`,
      projectName,
      requiresConfirmation: true,
      changeDetails: JSON.stringify({ requestId: saved.id, editType, editSummary }),
    });
  }

  return saved;
}

const router = Router();

function isCosRealised(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasInvDate = !!(exp.expenseInvoicedDate && String(exp.expenseInvoicedDate).trim());
  const hasPO = !!(exp.expensePoNumber && String(exp.expensePoNumber).trim());
  if (!hasPO || !hasInvoice || !hasInvDate) return false;
  const dateConfirmed =
    exp.invoiceDateConfirmed === true ||
    exp.invoiceDateFontColor === 'black';
  return dateConfirmed;
}

function isCashflowConfirmed(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  const payDateConfirmed =
    exp.paymentDateConfirmed === true ||
    exp.paymentDateFontColor === 'black';
  return payDateConfirmed;
}

function getWeekStartDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().split('T')[0];
}

function calculateRevenueRecognition(
  expenses: any[],
  projectName: string | null
): { weekly: Map<string, Map<string, number>>, cumulative: Map<string, Map<string, number>> } {
  const weekly = new Map<string, Map<string, number>>();
  const cumulative = new Map<string, Map<string, number>>();

  const relevantExpenses = expenses.filter(e =>
    (!projectName || e.projectName === projectName) &&
    e.expenseInvoiceNumber &&
    e.expenseInvoicedDate &&
    (e.actualCosTotal || e.expenseActualTotal) &&
    parseFloat(e.actualCosTotal || e.expenseActualTotal || "0") !== 0
  );

  for (const expense of relevantExpenses) {
    const pName = expense.projectName;
    const weekStart = getWeekStartDate(expense.expenseInvoicedDate);
    const amount = parseFloat(expense.actualCosTotal || expense.expenseActualTotal || "0");

    if (!weekly.has(pName)) {
      weekly.set(pName, new Map());
    }
    const projectWeekly = weekly.get(pName)!;
    projectWeekly.set(weekStart, (projectWeekly.get(weekStart) || 0) + amount);
  }

  Array.from(weekly.entries()).forEach(([pName, weeklyData]) => {
    const sortedWeeks = Array.from(weeklyData.keys()).sort();
    let runningTotal = 0;
    const cumulativeData = new Map<string, number>();

    for (const week of sortedWeeks) {
      runningTotal += weeklyData.get(week) || 0;
      cumulativeData.set(week as string, runningTotal);
    }

    cumulative.set(pName, cumulativeData);
  });

  return { weekly, cumulative };
}

function applyPlanningOverrides(
  baselinePoints: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselinePoints;

  const overrideMap = new Map<string, number>();
  overrides.forEach((o: any) => {
    const key = `${o.projectName}|${o.weekStartDate}|${o.seriesName}`;
    const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
    if (!isNaN(numValue)) {
      overrideMap.set(key, numValue);
    }
  });

  return baselinePoints.map((point: any) => {
    const key = `${point.projectName}|${point.pointDate}|${point.seriesName}`;
    if (overrideMap.has(key)) {
      return {
        ...point,
        value: overrideMap.get(key)!,
      };
    }
    return point;
  });
}

function applyRevenueTrackingOverrides(
  baselineRows: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineRows;

  const overrideMap = new Map<number, Map<string, any>>();
  overrides.forEach((o: any) => {
    if (!overrideMap.has(o.rowNumber)) {
      overrideMap.set(o.rowNumber, new Map());
    }
    overrideMap.get(o.rowNumber)!.set(o.fieldName, o.overrideValue);
  });

  return baselineRows.map((row: any) => {
    if (!row.rowNumber || !overrideMap.has(row.rowNumber)) {
      return row;
    }
    const fieldOverrides = overrideMap.get(row.rowNumber)!;
    const updatedRow = { ...row };
    fieldOverrides.forEach((value, fieldName) => {
      if (fieldName === 'inBank') {
        updatedRow[fieldName] = value === '1' || value === 1 || value === true ? 1 : 0;
      } else {
        updatedRow[fieldName] = value;
      }
    });
    return updatedRow;
  });
}

function resolveInflowEffectiveDates(
  inflows: any[],
  taskLinks: any[],
  operationalTasks: any[],
  planTasks: any[]
): any[] {
  if (taskLinks.length === 0) {
    return inflows.map(inf => ({
      ...inf,
      effectiveDate: inf.paymentReceivedDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate || null,
    }));
  }

  const linkMap = new Map<string, any>();
  for (const link of taskLinks) {
    linkMap.set(`${link.projectName}::${link.milestoneRowNumber}`, link);
  }

  const opTaskMap = new Map<number, any>();
  for (const t of operationalTasks) {
    opTaskMap.set(t.id, t);
  }

  const planTaskMap = new Map<number, any>();
  for (const t of planTasks) {
    planTaskMap.set(t.id, t);
  }

  return inflows.map(inf => {
    const key = `${inf.projectName}::${inf.rowNumber}`;
    const link = linkMap.get(key);

    if (inf.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inf.paymentReceivedDate)) {
      return { ...inf, effectiveDate: inf.paymentReceivedDate };
    }

    if (link) {
      if (link.dateOverride && /^\d{4}-\d{2}-\d{2}/.test(link.dateOverride)) {
        return { ...inf, effectiveDate: link.dateOverride };
      }

      const taskId = link.taskId;
      if (taskId > 0) {
        const opTask = opTaskMap.get(taskId);
        if (opTask?.dueDate && /^\d{4}-\d{2}-\d{2}/.test(opTask.dueDate)) {
          return { ...inf, effectiveDate: opTask.dueDate };
        }
      } else if (taskId < 0) {
        const planTask = planTaskMap.get(Math.abs(taskId));
        const dueDate = (planTask as any)?.actualEnd || (planTask as any)?.baselineEnd || null;
        if (dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate)) {
          return { ...inf, effectiveDate: dueDate };
        }
      }
    }

    return {
      ...inf,
      effectiveDate: inf.computedForecastReceiptDate || inf.plannedPaymentDate || null,
    };
  });
}

function applyExpenditureOverrides(
  baselineRows: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineRows;

  const overrideMap = new Map<number, Map<string, any>>();
  overrides.forEach((o: any) => {
    if (!overrideMap.has(o.rowNumber)) {
      overrideMap.set(o.rowNumber, new Map());
    }
    overrideMap.get(o.rowNumber)!.set(o.fieldName, o.overrideValue);
  });

  return baselineRows.map((row: any) => {
    if (!row.rowNumber || !overrideMap.has(row.rowNumber)) {
      return row;
    }
    const fieldOverrides = overrideMap.get(row.rowNumber)!;
    const updatedRow = { ...row };
    fieldOverrides.forEach((value, fieldName) => {
      updatedRow[fieldName] = value;
    });
    return updatedRow;
  });
}

function applyFinanceRevenueOverrides(
  baselineData: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineData;

  const overrideMap = new Map<string, number>();
  overrides.forEach((o: any) => {
    const key = `${o.category}|${o.monthEndDate}`;
    const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
    if (!isNaN(numValue)) {
      overrideMap.set(key, numValue);
    }
  });

  return baselineData.map((row: any) => {
    const key = `${row.category}|${row.monthEndDate}`;
    if (overrideMap.has(key)) {
      return {
        ...row,
        value: overrideMap.get(key)!,
      };
    }
    return row;
  });
}

function applyFinanceCosOverrides(
  baselineData: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineData;

  const overrideMap = new Map<string, number>();
  overrides.forEach((o: any) => {
    const key = `${o.category}|${o.monthEndDate}`;
    const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
    if (!isNaN(numValue)) {
      overrideMap.set(key, numValue);
    }
  });

  return baselineData.map((row: any) => {
    const key = `${row.category}|${row.monthEndDate}`;
    if (overrideMap.has(key)) {
      return {
        ...row,
        value: overrideMap.get(key)!,
      };
    }
    return row;
  });
}

function safeNum(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getFYRange(date: Date = new Date()): { start: string; end: string } {
  const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    start: `${year}-09-01`,
    end: `${year + 1}-08-31`
  };
}

// ==================== PROGRAM COS CONTROL ====================

router.get("/api/program/cos", async (req, res) => {
  try {
    const { projectName, startDate, endDate, atRiskDays = '30' } = req.query;
    const atRiskDaysNum = parseInt(atRiskDays as string, 10) || 30;

    const [allExpenses, latestRefresh] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getLatestRefresh()
    ]);

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const fyRange = getFYRange();
    const filterStart = (startDate as string) || fyRange.start;
    const filterEnd = (endDate as string) || fyRange.end;

    let filtered = allExpenses.filter(e => e.rowType === 'item');
    if (projectName) {
      filtered = filtered.filter(e => e.projectName === projectName);
    }

    let totalCosRealised = 0;
    let totalCashPaid = 0;
    let outstandingCos = 0;
    let atRiskCount = 0;
    let totalBudget = 0;
    const supplierMap = new Map<string, number>();
    const projectCosMap = new Map<string, number>();
    const monthlyCategoryMap = new Map<string, Map<string, number>>();

    const nowCos = new Date();
    const currentMonthEnd = `${nowCos.getFullYear()}-${String(nowCos.getMonth() + 1).padStart(2, '0')}-31`;

    for (const exp of filtered) {
      const invoiceDate = exp.expenseInvoicedDate;
      const paymentDate = exp.expensePaymentDate;
      const amount = safeNum(exp.expenseActualTotal);
      const cosAmount = safeNum(exp.actualCosTotal) || amount;
      const budgetAmount = safeNum(exp.budgetTotal);
      const category = exp.expenseCategory || 'Panels';

      totalBudget += budgetAmount;

      if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && invoiceDate <= currentMonthEnd) {
        totalCosRealised += cosAmount;

        const monthKey = invoiceDate.substring(0, 7);
        if (!monthlyCategoryMap.has(category)) {
          monthlyCategoryMap.set(category, new Map());
        }
        const categoryMonths = monthlyCategoryMap.get(category)!;
        categoryMonths.set(monthKey, (categoryMonths.get(monthKey) || 0) + cosAmount);

        projectCosMap.set(exp.projectName, (projectCosMap.get(exp.projectName) || 0) + cosAmount);

        const invoiceNum = exp.expenseInvoiceNumber || '';
        let supplier = 'Unknown';
        if (invoiceNum.includes(':')) {
          supplier = invoiceNum.split(':')[0].trim();
        } else if (invoiceNum.includes('-')) {
          supplier = invoiceNum.split('-')[0].trim();
        } else if (invoiceNum.length > 0) {
          supplier = invoiceNum.substring(0, Math.min(20, invoiceNum.length));
        }
        supplierMap.set(supplier, (supplierMap.get(supplier) || 0) + cosAmount);
      }

      if (paymentDate && paymentDate >= filterStart && paymentDate <= filterEnd) {
        totalCashPaid += amount;
      }

      if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && invoiceDate <= currentMonthEnd && !paymentDate) {
        outstandingCos += cosAmount;

        const invoiceDateObj = new Date(invoiceDate);
        const daysSinceInvoice = Math.floor((today.getTime() - invoiceDateObj.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceInvoice > atRiskDaysNum) {
          atRiskCount++;
        }
      }
    }

    const topSuppliers = Array.from(supplierMap.entries())
      .map(([supplier, total]) => ({ supplier, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const topProjects = Array.from(projectCosMap.entries())
      .map(([project, total]) => ({ project: project.replace('_Tracker', ''), total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const allMonths = new Set<string>();
    for (const monthMap of Array.from(monthlyCategoryMap.values())) {
      for (const month of Array.from(monthMap.keys())) {
        allMonths.add(month);
      }
    }
    const sortedMonths = Array.from(allMonths).sort();

    const monthlyCosMatrix = Array.from(monthlyCategoryMap.entries())
      .map(([category, monthMap]) => {
        const row: Record<string, string | number> = { category };
        let total = 0;
        for (const month of sortedMonths) {
          const value = monthMap.get(month) || 0;
          row[month] = value;
          total += value;
        }
        row.total = total;
        return row;
      })
      .sort((a, b) => (b.total as number) - (a.total as number));

    const paidVsBudgetPercent = totalBudget > 0 ? (totalCashPaid / totalBudget) * 100 : 0;

    res.json({
      lastRefresh: latestRefresh?.refreshedAt || null,
      fyRange,
      filterRange: { start: filterStart, end: filterEnd },
      kpis: {
        totalCosRealised,
        cashPaid: totalCashPaid,
        outstandingCos,
        paidVsBudget: paidVsBudgetPercent,
        totalBudget,
        atRiskCount,
        supplierCount: supplierMap.size
      },
      topProjects,
      topSuppliers,
      monthlyCosMatrix: {
        months: sortedMonths,
        rows: monthlyCosMatrix
      }
    });
  } catch (error) {
    console.error("Program COS error:", error);
    res.status(500).json({ error: "Failed to fetch program COS data" });
  }
});

// ==================== CASHFLOW 2026 ====================

router.get("/api/cashflow-2026", requireAuth, async (req, res) => {
  try {
    const projectFilter = req.query.project ? String(req.query.project) : null;

    const [allExpenses, rawInflows, manualBalances, opexBudgets, opexWeeklyOverrides, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllCashflowWeeklyManual(),
      storage.getAllOpexBudgetMonthly(),
      storage.getAllOpexWeeklyManual(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
    ]);

    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

    const manualMap = new Map(manualBalances.map(m => [m.weekStartDate, parseFloat(m.openingBalance || "0")]));
    const opexMonthlyMap = new Map(opexBudgets.map(o => [o.monthKey, parseFloat(o.amount || "0")]));
    const opexWeeklyMap = new Map(opexWeeklyOverrides.map(o => [o.weekStartDate, parseFloat(o.opexAmount || "0")]));

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
          projectInflowsSum += parseFloat(inflow.milestoneAmount);
        }
      }

      let projectOutflowsSum = 0;
      for (const expense of allExpenses) {
        if (projectFilter && expense.projectName !== projectFilter) continue;
        const d = expense.expensePaymentDate;
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        if (d >= weekStart && d < weekEnd && expense.expenseActualTotal) {
          projectOutflowsSum += parseFloat(expense.expenseActualTotal);
        }
      }

      const computedOpening = runningBalance;
      const hasManualOverride = manualMap.has(weekStart);
      const openingBalance = hasManualOverride ? manualMap.get(weekStart)! : computedOpening;
      const balanceDelta = hasManualOverride ? openingBalance - computedOpening : 0;

      const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthlyOpex = opexMonthlyMap.get(mk) || 0;
      const weeksCount = weeksInMonth.get(mk) || 1;
      const computedOpex = monthlyOpex / weeksCount;
      const hasOpexOverride = opexWeeklyMap.has(weekStart);
      const opexOutflows = hasOpexOverride ? opexWeeklyMap.get(weekStart)! : computedOpex;

      const closingBalance = openingBalance + projectInflowsSum - opexOutflows - projectOutflowsSum;
      const availablePayment = openingBalance + projectInflowsSum;

      weeks.push({
        weekStart,
        weekEnd,
        projectInflows: projectInflowsSum,
        projectOutflows: projectOutflowsSum,
        openingBalance,
        computedOpening,
        hasManualOverride,
        balanceDelta,
        opexOutflows,
        computedOpex,
        hasOpexOverride,
        closingBalance,
        availablePayment,
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

router.get("/api/cashflow-2026/detail", requireAuth, async (req, res) => {
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

    const [allExpenses, rawInflows, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
    ]);

    const resolvedInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

    const outflows = allExpenses
      .filter(e => {
        if (projectFilter && e.projectName !== projectFilter) return false;
        const pd = e.expensePaymentDate;
        if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return false;
        return pd >= weekStart && pd < weekEnd;
      })
      .map(e => ({
        projectName: e.projectName,
        expenseCategory: e.expenseCategory,
        expenseLineItem: e.expenseLineItem,
        expenseInvoiceNumber: e.expenseInvoiceNumber,
        expensePaymentDate: e.expensePaymentDate,
        expenseActualTotal: e.expenseActualTotal ? parseFloat(e.expenseActualTotal) : 0,
      }));

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
        return {
          projectName: inf.projectName,
          milestoneName: inf.milestoneName,
          milestoneInvoiceNumber: inf.milestoneInvoiceNumber,
          paymentReceivedDate: inf.effectiveDate,
          milestoneAmount: inf.milestoneAmount ? parseFloat(inf.milestoneAmount) : 0,
          invoiceRaisedDate: inf.invoiceRaisedDate,
          daysToReceipt,
          isOverride: inf.effectiveDate !== inf.paymentReceivedDate,
        };
      });

    res.json({ outflows, inflows });
  } catch (error) {
    console.error("Cashflow 2026 detail error:", error);
    res.status(500).json({ error: "Failed to fetch cashflow detail", message: "Failed to fetch cashflow detail" });
  }
});

// ==================== MANUAL INPUT ENDPOINTS ====================

router.post("/api/cashflow-2026/opening-balance", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStartDate, openingBalance, computedValue, clearForward } = req.body;
    if (!weekStartDate || openingBalance == null) {
      return res.status(400).json({ error: "weekStartDate and openingBalance required" });
    }

    const existingManuals = await storage.getAllCashflowWeeklyManual();
    const existing = existingManuals.find(m => m.weekStartDate === weekStartDate);
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

    res.json({ ...result, clearedWeeks });
  } catch (error) {
    console.error("Opening balance save error:", error);
    res.status(500).json({ error: "Failed to save opening balance", message: "Failed to save opening balance" });
  }
});

router.get("/api/cashflow-2026/balance-history", requireAuth, async (req, res) => {
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

router.delete("/api/cashflow-2026/opening-balance", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStartDate } = req.body;
    if (!weekStartDate) {
      return res.status(400).json({ error: "weekStartDate required" });
    }
    const existingManuals = await storage.getAllCashflowWeeklyManual();
    const existing = existingManuals.find(m => m.weekStartDate === weekStartDate);
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
    res.json({ ok: true });
  } catch (error) {
    console.error("Opening balance delete error:", error);
    res.status(500).json({ error: "Failed to delete opening balance" });
  }
});

router.post("/api/cashflow-2026/opex-budget", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { monthKey, amount } = req.body;
    if (!monthKey || amount == null) {
      return res.status(400).json({ error: "monthKey and amount required" });
    }
    const result = await storage.upsertOpexBudgetMonthly(monthKey, String(amount));
    res.json(result);
  } catch (error) {
    console.error("OPEX budget save error:", error);
    res.status(500).json({ error: "Failed to save OPEX budget", message: "Failed to save OPEX budget" });
  }
});

router.get("/api/cashflow-2026/opex-budget", requireAuth, async (req, res) => {
  try {
    const entries = await storage.getAllOpexBudgetMonthly();
    res.json(entries);
  } catch (error) {
    console.error("OPEX budget fetch error:", error);
    res.status(500).json({ error: "Failed to fetch OPEX budgets", message: "Failed to fetch OPEX budgets" });
  }
});

router.post("/api/cashflow-2026/opex-weekly", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStartDate, opexAmount } = req.body;
    if (!weekStartDate || opexAmount == null) {
      return res.status(400).json({ error: "weekStartDate and opexAmount required" });
    }
    const result = await storage.upsertOpexWeeklyManual(weekStartDate, String(opexAmount));
    res.json(result);
  } catch (error) {
    console.error("OPEX weekly save error:", error);
    res.status(500).json({ error: "Failed to save weekly OPEX" });
  }
});

router.delete("/api/cashflow-2026/opex-weekly", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStartDate } = req.body;
    if (!weekStartDate) {
      return res.status(400).json({ error: "weekStartDate required" });
    }
    await storage.deleteOpexWeeklyManual(weekStartDate);
    res.json({ success: true });
  } catch (error) {
    console.error("OPEX weekly delete error:", error);
    res.status(500).json({ error: "Failed to delete weekly OPEX override" });
  }
});

// ==================== TRACKER MONTHLY ====================

router.post("/api/tracker-monthly", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { trackerType, monthKey, realised, outstanding, budget } = req.body;
    if (!trackerType || !monthKey) {
      return res.status(400).json({ error: "trackerType and monthKey required" });
    }
    const result = await storage.upsertTrackerMonthlyManual({
      trackerType,
      monthKey,
      realised: realised != null ? String(realised) : null,
      outstanding: outstanding != null ? String(outstanding) : null,
      budget: budget != null ? String(budget) : null,
    });
    res.json(result);
  } catch (error) {
    console.error("Tracker monthly save error:", error);
    res.status(500).json({ error: "Failed to save tracker entry", message: "Failed to save tracker entry" });
  }
});

router.get("/api/tracker-monthly/:type", requireAuth, requireAdmin, async (req, res) => {
  try {
    const trackerType = (req.params.type as string).toUpperCase();
    if (trackerType !== 'REV' && trackerType !== 'COS') {
      return res.status(400).json({ error: "Type must be REV or COS" });
    }
    const entries = await storage.getTrackerMonthlyManual(trackerType);
    res.json(entries);
  } catch (error) {
    console.error("Tracker monthly fetch error:", error);
    res.status(500).json({ error: "Failed to fetch tracker entries", message: "Failed to fetch tracker entries" });
  }
});

// ==================== REV TRACKER API ====================

router.get("/api/rev-tracker", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [allInflows, manualEntries] = await Promise.all([
      storage.getAllProgramInflows(),
      storage.getTrackerMonthlyManual('REV'),
    ]);

    const manualMap = new Map(manualEntries.map(e => [e.monthKey, e]));

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));

    let ytdPlanned = 0, ytdRealised = 0, ytdOutstanding = 0, ytdBudget = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;
      const monthStart = `${monthKey}-01`;
      const nextMonth = new Date(Date.UTC(yr, mo + 1, 1));
      const monthEnd = nextMonth.toISOString().split('T')[0];

      let planned = 0;
      for (const inflow of allInflows) {
        const d = inflow.invoiceRaisedDate;
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        if (d >= monthStart && d < monthEnd && inflow.milestoneAmount) {
          planned += parseFloat(inflow.milestoneAmount);
        }
      }

      const manual = manualMap.get(monthKey);
      const realised = manual?.realised ? parseFloat(manual.realised) : 0;
      const outstanding = manual?.outstanding ? parseFloat(manual.outstanding) : 0;
      const budget = manual?.budget ? parseFloat(manual.budget) : 0;

      const variance = planned - budget;
      const variancePct = budget !== 0 ? (planned - budget) / budget : 0;

      ytdPlanned += planned;
      ytdRealised += realised;
      ytdOutstanding += outstanding;
      ytdBudget += budget;
      const ytdVariance = ytdPlanned - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdPlanned - ytdBudget) / ytdBudget : 0;

      months.push({
        monthKey,
        label: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        planned,
        realised,
        outstanding,
        budget,
        variance,
        variancePct,
        ytdPlanned,
        ytdRealised,
        ytdOutstanding,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
      });
    }

    res.json(months);
  } catch (error) {
    console.error("REV tracker error:", error);
    res.status(500).json({ error: "Failed to fetch REV tracker data", message: "Failed to fetch REV tracker data" });
  }
});

// ==================== COS TRACKER API ====================

router.get("/api/cos-tracker", requireAuth, async (req, res) => {
  try {
    const [allProgramExpenses, manualEntries, rawInflows, allTaskLinks, allOpTasks, allPlans] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getTrackerMonthlyManual('COS'),
      storage.getAllProgramInflows(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
    ]);
    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const revByMonth = new Map<string, number>();
    for (const inflow of allInflows) {
      if (!inflow.milestoneAmount) continue;
      const amt = parseFloat(inflow.milestoneAmount as string);
      if (isNaN(amt) || amt === 0) continue;
      const hasInvoice = !!inflow.milestoneInvoiceNumber && inflow.milestoneInvoiceNumber.trim() !== '';
      const hasPayment = !!inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inflow.paymentReceivedDate);
      if (hasInvoice && hasPayment) {
        const dateMatch = inflow.paymentReceivedDate!.match(/^(\d{4})-(\d{2})/);
        if (dateMatch) {
          const mk = `${dateMatch[1]}-${dateMatch[2]}`;
          revByMonth.set(mk, (revByMonth.get(mk) || 0) + amt);
        }
      }
    }

    const manualMap = new Map(manualEntries.map(e => [e.monthKey, e]));

    const cosByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    const realisedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    for (const exp of allProgramExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');

      if (!cosByMonth.has(monthKey)) {
        cosByMonth.set(monthKey, { total: 0, projects: new Map() });
      }
      const cosBucket = cosByMonth.get(monthKey)!;
      cosBucket.total += amount;
      cosBucket.projects.set(pName, (cosBucket.projects.get(pName) || 0) + amount);

      const isRealised = isCosRealised(exp) && monthKey <= currentMonthKey;

      if (isRealised) {
        if (!realisedByMonth.has(monthKey)) {
          realisedByMonth.set(monthKey, { total: 0, projects: new Map() });
        }
        const realBucket = realisedByMonth.get(monthKey)!;
        realBucket.total += amount;
        realBucket.projects.set(pName, (realBucket.projects.get(pName) || 0) + amount);
      }
    }

    const staticCosBudget: Record<string, number> = {
      '2025-09': 8083466.99,
      '2025-10': 16346971.77,
      '2025-11': 20803804.86,
      '2025-12': 12381055.48,
      '2026-01': 12395435.22,
      '2026-02': 20724666.08,
      '2026-03': 30199956.69,
      '2026-04': 21137178.14,
      '2026-05': 31405517.81,
      '2026-06': 41720854.07,
      '2026-07': 30116780.50,
      '2026-08': 73983803.91,
    };

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));

    let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0, ytdRevRealised = 0;

    function mapToArray(m: Map<string, number>): { projectName: string; value: number }[] {
      const arr: { projectName: string; value: number }[] = [];
      m.forEach((v, k) => arr.push({ projectName: k, value: v }));
      return arr.sort((a, b) => b.value - a.value);
    }

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const bucket = cosByMonth.get(monthKey);
      const totalCOS = bucket?.total ?? 0;

      const realisedBucket = realisedByMonth.get(monthKey);
      const realisedCOS = realisedBucket?.total ?? 0;
      const unrealisedCOS = totalCOS - realisedCOS;

      const manual = manualMap.get(monthKey);
      const budget = manual?.budget ? parseFloat(manual.budget) : (staticCosBudget[monthKey] ?? 0);

      const variance = totalCOS - budget;
      const variancePct = budget !== 0 ? variance / budget : 0;

      const revRealised = revByMonth.get(monthKey) ?? 0;
      ytdCOS += totalCOS;
      ytdRealised += realisedCOS;
      ytdBudget += budget;
      ytdRevRealised += revRealised;
      const ytdUnrealised = ytdCOS - ytdRealised;
      const ytdVariance = ytdCOS - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? ytdVariance / ytdBudget : 0;

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalCOS,
        realisedCOS,
        unrealisedCOS,
        budget,
        variance,
        variancePct,
        revRealised,
        ytdCOS,
        ytdRealised,
        ytdUnrealised,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        ytdRevRealised,
        cosProjects: mapToArray(bucket?.projects ?? new Map()),
        realisedProjects: mapToArray(realisedBucket?.projects ?? new Map()),
        unrealisedProjects: (() => {
          const cosPs = bucket?.projects ?? new Map<string, number>();
          const realPs = realisedBucket?.projects ?? new Map<string, number>();
          const unrealMap = new Map<string, number>();
          cosPs.forEach((v, k) => {
            const diff = v - (realPs.get(k) || 0);
            if (diff !== 0) unrealMap.set(k, diff);
          });
          return mapToArray(unrealMap);
        })(),
      });
    }

    res.json(months);
  } catch (error) {
    console.error("COS tracker error:", error);
    res.status(500).json({ error: "Failed to fetch COS tracker data", message: "Failed to fetch COS tracker data" });
  }
});

router.get("/api/cos-tracker/month-detail", requireAuth, async (req, res) => {
  try {
    const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const match = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) return res.status(400).json({ error: "Invalid monthKey format" });

    const allExpenses = await storage.getAllProgramExpenses();

    interface LineItem {
      id: number;
      projectName: string;
      category: string | null;
      lineItem: string | null;
      amount: number;
      invoiceNumber: string | null;
      poNumber: string | null;
      invoiceDate: string | null;
      invoiceDateConfirmed: boolean;
      paymentDate: string | null;
      paymentDateConfirmed: boolean;
      supplier: string | null;
      isRealised: boolean;
      realisedMonth: string | null;
      cosState: string;
    }

    const items: LineItem[] = [];

    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const cosTotal = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(cosTotal) || cosTotal === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      const payDate = exp.expensePaymentDate as string | null;
      const forecastDate = exp.forecastPaymentDate as string | null;

      let itemMonthKey: string | null = null;
      if (invDate) {
        const dm = invDate.match(/^(\d{4})-(\d{2})/);
        if (dm) itemMonthKey = `${dm[1]}-${dm[2]}`;
      } else if (forecastDate) {
        const dm = forecastDate.match(/^(\d{4})-(\d{2})/);
        if (dm) itemMonthKey = `${dm[1]}-${dm[2]}`;
      }

      const nowD = new Date();
      const curMK = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
      const isFutureMonth = itemMonthKey ? itemMonthKey > curMK : false;

      const isRealised = isCosRealised(exp) && !isFutureMonth;
      const isConfirmedPayment = isCashflowConfirmed(exp) && !isFutureMonth;

      let cosState = 'Planned';
      if (isConfirmedPayment) {
        cosState = 'Paid';
      } else if (isRealised) {
        cosState = 'Invoiced';
      } else if (exp.expensePoNumber) {
        cosState = 'Committed';
      }

      if (itemMonthKey !== monthKey) continue;

      let realisedMonth: string | null = null;
      if (isRealised && invDate) {
        const dm = invDate.match(/^(\d{4})-(\d{2})/);
        if (dm) {
          const d = new Date(Date.UTC(parseInt(dm[1]), parseInt(dm[2]) - 1, 1));
          realisedMonth = d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        }
      }

      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      if (project && pName !== project) continue;
      if (stateFilter === 'realised' && !isRealised) continue;
      if (stateFilter === 'unrealised' && isRealised) continue;

      items.push({
        id: exp.id,
        projectName: pName,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        amount: cosTotal,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: invDate,
        invoiceDateConfirmed: isRealised,
        paymentDate: payDate,
        paymentDateConfirmed: isConfirmedPayment,
        supplier: exp.supplierName || null,
        isRealised,
        realisedMonth,
        cosState,
      });
    }

    items.sort((a, b) => b.amount - a.amount);

    const realisedTotal = items.filter(i => i.isRealised).reduce((s, i) => s + i.amount, 0);
    const unrealisedTotal = items.filter(i => !i.isRealised).reduce((s, i) => s + i.amount, 0);

    res.json({
      monthKey,
      lineCount: items.length,
      totalAmount: items.reduce((s, i) => s + i.amount, 0),
      realisedTotal,
      unrealisedTotal,
      realisedCount: items.filter(i => i.isRealised).length,
      unrealisedCount: items.filter(i => !i.isRealised).length,
      items,
    });
  } catch (error) {
    console.error("COS month detail error:", error);
    res.status(500).json({ error: "Failed to fetch COS month detail" });
  }
});

router.patch("/api/cos-tracker/toggle-realised/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });

    const { realised } = req.body as { realised: boolean };
    if (typeof realised !== 'boolean') return res.status(400).json({ error: "realised (boolean) required" });

    const allExpenses = await storage.getAllProgramExpenses();
    const expense = allExpenses.find(e => e.id === id);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    if (realised && !expense.expenseInvoiceNumber) {
      return res.status(400).json({ error: "Cannot mark as realised without an invoice number" });
    }

    await storage.updateProgramExpenseFields(id, {
      invoiceDateConfirmed: realised,
    });

    const updatedExpenses = await storage.getAllProgramExpenses();
    const updatedExpense = updatedExpenses.find(e => e.id === id);
    if (updatedExpense) {
      const newState = classifyExpenseState(updatedExpense as any);
      await storage.updateProgramExpenseFields(id, {
        computedState: newState,
      });
    }

    res.json({ success: true, id, realised });
  } catch (error) {
    console.error("Toggle realised error:", error);
    res.status(500).json({ error: "Failed to toggle realised status" });
  }
});

// ==================== BUDGETS CRUD ====================

router.get("/api/budgets", async (req, res) => {
  try {
    const budgets = await storage.getAllBudgets();
    res.json(budgets);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch budgets", message: "Failed to fetch budgets" });
  }
});

router.post("/api/budgets", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = insertBudgetSchema.parse(req.body);
    const budget = await storage.createBudget(parsed);
    res.status(201).json(budget);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid budget data", message: "Invalid budget data", errors: error.errors });
    }
    res.status(500).json({ error: "Failed to create budget", message: "Failed to create budget" });
  }
});

router.delete("/api/budgets/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const deleted = await storage.deleteBudget(id);
    if (!deleted) {
      return res.status(404).json({ error: "Budget not found", message: "Budget not found" });
    }
    res.json({ message: "Budget deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete budget", message: "Failed to delete budget" });
  }
});

// ==================== PROGRAM EXPENSES & INFLOWS ====================

router.get("/api/program-expenses", async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let expenses;

    if (projectName && typeof projectName === 'string') {
      expenses = await storage.getProgramExpensesByProject(projectName);

      if (applyOverrides === 'true') {
        const overrides = await storage.getExpenditureOverridesByProject(projectName);
        expenses = applyExpenditureOverrides(expenses, overrides);
      }
    } else {
      expenses = await storage.getAllProgramExpenses();
    }

    if (startDate && typeof startDate === 'string') {
      expenses = expenses.filter(e => e.expensePaymentDate && e.expensePaymentDate >= startDate);
    }
    if (endDate && typeof endDate === 'string') {
      expenses = expenses.filter(e => e.expensePaymentDate && e.expensePaymentDate <= endDate);
    }

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch program expenses", message: "Failed to fetch program expenses" });
  }
});

router.get("/api/program-expenses/:projectName", async (req, res) => {
  try {
    const { projectName } = req.params;
    const { applyOverrides } = req.query;

    let expenses = await storage.getProgramExpensesByProject(projectName);

    if (applyOverrides === 'true') {
      const overrides = await storage.getExpenditureOverridesByProject(projectName);
      expenses = applyExpenditureOverrides(expenses, overrides);
    }

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch program expenses", message: "Failed to fetch program expenses" });
  }
});

router.get("/api/program-inflows", async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let inflows;

    if (projectName && typeof projectName === 'string') {
      inflows = await storage.getProgramInflowsByProject(projectName);

      if (applyOverrides === 'true') {
        const overrides = await storage.getRevenueTrackingOverridesByProject(projectName);
        inflows = applyRevenueTrackingOverrides(inflows, overrides);
      }
    } else {
      inflows = await storage.getAllProgramInflows();
    }

    if (startDate && typeof startDate === 'string') {
      inflows = inflows.filter(i =>
        (i.paymentReceivedDate && i.paymentReceivedDate >= startDate) ||
        (i.plannedPaymentDate && i.plannedPaymentDate >= startDate)
      );
    }
    if (endDate && typeof endDate === 'string') {
      inflows = inflows.filter(i =>
        (i.paymentReceivedDate && i.paymentReceivedDate <= endDate) ||
        (i.plannedPaymentDate && i.plannedPaymentDate <= endDate)
      );
    }

    res.json(inflows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch program inflows", message: "Failed to fetch program inflows" });
  }
});

// ==================== CASHFLOW & PLANNING OVERRIDES ====================

router.get("/api/cashflow", async (req, res) => {
  try {
    const projectParam = req.query.project || req.query.projectName;
    const { startDate, endDate } = req.query;
    const projectName = (projectParam && typeof projectParam === 'string') ? projectParam : null;

    let points: any[];
    if (projectName) {
      points = await storage.getCashflowPointsByProject(projectName);
    } else {
      points = await storage.getAllCashflowPoints();
    }

    const overrides = await storage.getAllPlanningOverrides();
    points = applyPlanningOverrides(points, overrides);

    const expenses = projectName
      ? await storage.getProgramExpensesByProject(projectName)
      : await storage.getAllProgramExpenses();

    const [rawInflows, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
      projectName ? storage.getProgramInflowsByProject(projectName) : storage.getAllProgramInflows(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
    ]);

    const resolvedInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

    const baselineDates = new Set<string>();
    points.forEach(p => baselineDates.add(p.pointDate));
    const weekDates = Array.from(baselineDates).sort();

    if (weekDates.length > 0) {
      const projectNames = projectName ? [projectName] : [...new Set(points.map(p => p.projectName))];

      const dynamicPoints: any[] = [];

      for (const pn of projectNames) {
        const projExpenses = expenses.filter((e: any) => e.projectName === pn && e.rowType === 'item');
        const projInflows = resolvedInflows.filter((i: any) => i.projectName === pn);

        const weeklyRevenue = new Map<string, number>();
        const weeklyExpenditure = new Map<string, number>();

        for (const inf of projInflows) {
          const d = inf.effectiveDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
          const amt = parseFloat(inf.milestoneAmount || '0');
          if (amt === 0) continue;
          let matchWeek: string | null = null;
          for (let i = 0; i < weekDates.length; i++) {
            const wk = weekDates[i];
            const nextWk = weekDates[i + 1] || '9999-12-31';
            if (d >= wk && d < nextWk) { matchWeek = wk; break; }
          }
          if (!matchWeek && d < weekDates[0]) matchWeek = weekDates[0];
          if (!matchWeek && d >= weekDates[weekDates.length - 1]) matchWeek = weekDates[weekDates.length - 1];
          if (matchWeek) {
            weeklyRevenue.set(matchWeek, (weeklyRevenue.get(matchWeek) || 0) + amt);
          }
        }

        for (const exp of projExpenses) {
          const d = exp.expensePaymentDate || exp.computedForecastPaymentDate || exp.forecastPaymentDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
          const amt = parseFloat(exp.expenseActualTotal || exp.budgetTotal || '0');
          if (amt === 0) continue;
          let matchWeek: string | null = null;
          for (let i = 0; i < weekDates.length; i++) {
            const wk = weekDates[i];
            const nextWk = weekDates[i + 1] || '9999-12-31';
            if (d >= wk && d < nextWk) { matchWeek = wk; break; }
          }
          if (!matchWeek && d < weekDates[0]) matchWeek = weekDates[0];
          if (!matchWeek && d >= weekDates[weekDates.length - 1]) matchWeek = weekDates[weekDates.length - 1];
          if (matchWeek) {
            weeklyExpenditure.set(matchWeek, (weeklyExpenditure.get(matchWeek) || 0) + amt);
          }
        }

        let cumRevenue = 0;
        let cumExpenditure = 0;
        for (const wk of weekDates) {
          cumRevenue += weeklyRevenue.get(wk) || 0;
          cumExpenditure += weeklyExpenditure.get(wk) || 0;

          dynamicPoints.push({
            id: null,
            projectName: pn,
            seriesName: "Actual + Planned Revenue",
            pointDate: wk,
            value: cumRevenue.toFixed(2),
            createdAt: null,
          });
          dynamicPoints.push({
            id: null,
            projectName: pn,
            seriesName: "Actual + Planned Expenditure",
            pointDate: wk,
            value: cumExpenditure.toFixed(2),
            createdAt: null,
          });
          dynamicPoints.push({
            id: null,
            projectName: pn,
            seriesName: "ACTUAL CashFlow",
            pointDate: wk,
            value: (cumRevenue - cumExpenditure).toFixed(2),
            createdAt: null,
          });
        }
      }

      points = points.filter(p =>
        p.seriesName !== "Actual + Planned Revenue" &&
        p.seriesName !== "Actual + Planned Expenditure" &&
        p.seriesName !== "ACTUAL CashFlow"
      );
      points.push(...dynamicPoints);
    }

    const { weekly, cumulative } = calculateRevenueRecognition(expenses, projectName);

    Array.from(weekly.entries()).forEach(([pName, weeklyData]) => {
      Array.from(weeklyData.entries()).forEach(([weekStart, amount]) => {
        points.push({
          id: null,
          projectName: pName,
          seriesName: "Revenue Recognition",
          pointDate: weekStart,
          value: amount.toString(),
          createdAt: null
        });
      });
    });

    Array.from(cumulative.entries()).forEach(([pName, cumulativeData]) => {
      Array.from(cumulativeData.entries()).forEach(([weekStart, amount]) => {
        points.push({
          id: null,
          projectName: pName,
          seriesName: "Revenue Recognition Cumulative",
          pointDate: weekStart,
          value: amount.toString(),
          createdAt: null
        });
      });
    });

    if (startDate && typeof startDate === 'string') {
      points = points.filter(p => p.pointDate >= startDate);
    }
    if (endDate && typeof endDate === 'string') {
      points = points.filter(p => p.pointDate <= endDate);
    }

    res.json(points);
  } catch (error) {
    console.error("Cashflow API error:", error);
    res.status(500).json({ error: "Failed to fetch cashflow data", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

router.get("/api/cashflow/planning-overrides", async (req, res) => {
  try {
    const { projectName } = req.query;
    let overrides;

    if (projectName && typeof projectName === 'string') {
      overrides = await storage.getPlanningOverridesByProject(projectName);
    } else {
      overrides = await storage.getAllPlanningOverrides();
    }

    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch planning overrides", message: "Failed to fetch planning overrides" });
  }
});

router.post("/api/cashflow/planning-overrides", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { overrides, overrideCategory, overrideComment } = req.body;

    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
    }

    if (!overrideCategory || !OVERRIDE_CATEGORIES.includes(overrideCategory)) {
      return res.status(400).json({ error: "Override category is required. Must be one of: " + OVERRIDE_CATEGORIES.join(", ") });
    }
    if (!overrideComment || typeof overrideComment !== "string" || overrideComment.trim().length < 3) {
      return res.status(400).json({ error: "Override comment is required (min 3 characters)" });
    }

    const userId = req.user?.id;
    const overridesWithUser = overrides.map((o: any) => {
      const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
      if (isNaN(numValue)) {
        throw new Error(`Invalid override value: ${o.overrideValue}`);
      }
      return {
        ...o,
        overrideValue: numValue.toString(),
        createdBy: userId
      };
    });

    const saved = await storage.upsertManyPlanningOverrides(overridesWithUser);

    try {
      for (const o of overrides) {
        await recordOverride({
          actorUserId: userId,
          actorRole: (req as any).user?.role,
          entityType: "planning_override",
          entityId: `${o.projectName}|${o.weekStartDate}|${o.seriesName}`,
          projectName: o.projectName,
          action: "PLANNING_OVERRIDE",
          overrideCategory,
          overrideComment: overrideComment.trim(),
          oldRecord: {},
          newRecord: { overrideValue: o.overrideValue },
        });
      }
    } catch (auditErr: any) {
      console.warn("[audit] Planning override audit failed (non-blocking):", auditErr.message);
    }

    res.json({ message: "Planning overrides saved", count: saved.length, overrides: saved });
  } catch (error) {
    res.status(500).json({
      error: "Failed to save planning overrides",
      message: error instanceof Error ? error.message : "Failed to save planning overrides"
    });
  }
});

router.delete("/api/cashflow/planning-overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deletePlanningOverridesByProject(projectName);
    res.json({ message: `Planning overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete planning overrides", message: "Failed to delete planning overrides" });
  }
});

// ==================== REVENUE TRACKING OVERRIDES ====================

router.get("/api/revenue-tracking/overrides", async (req, res) => {
  try {
    const { projectName } = req.query;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    const overrides = await storage.getRevenueTrackingOverridesByProject(projectName);
    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch revenue tracking overrides", message: "Failed to fetch revenue tracking overrides" });
  }
});

router.post("/api/revenue-tracking/overrides", requireAuth, requireAdminOrFinancialEditor, requirePermission('financials', 'edit'), async (req, res) => {
  try {
    const { overrides, overrideCategory, overrideComment } = req.body;
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
    }
    if (!overrideCategory || !OVERRIDE_CATEGORIES.includes(overrideCategory)) {
      return res.status(400).json({ error: "Override category is required. Must be one of: " + OVERRIDE_CATEGORIES.join(", ") });
    }
    if (!overrideComment || typeof overrideComment !== "string" || overrideComment.trim().length < 3) {
      return res.status(400).json({ error: "Override comment is required (min 3 characters)" });
    }
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isPmOnlyRole(userRole)) {
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
      const editSummary = `Revenue override: ${overrides.length} field(s) across ${projectNames.length} project(s). Category: ${overrideCategory}. Comment: ${overrideComment.trim()}`;
      const saved = await createPendingEditRequest(
        userId!,
        projectNames[0] || "Unknown",
        "revenue_override",
        "revenue_tracking",
        { overrides, overrideCategory, overrideComment },
        editSummary
      );
      return res.json({
        message: "Your revenue edit has been submitted for approval",
        status: "pending_approval",
        requestId: saved.id,
      });
    }

    const overridesWithUser = overrides.map((o: any) => ({ ...o, createdBy: userId }));
    const saved = await storage.upsertManyRevenueTrackingOverrides(overridesWithUser);

    try {
      for (const o of overrides) {
        await recordOverride({
          actorUserId: userId,
          actorRole: (req as any).user?.role,
          entityType: "revenue_tracking_override",
          entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
          projectName: o.projectName,
          action: "REVENUE_OVERRIDE",
          overrideCategory,
          overrideComment: overrideComment.trim(),
          oldRecord: {},
          newRecord: { [o.fieldName]: o.overrideValue },
        });
      }
    } catch (auditErr: any) {
      console.warn("[audit] Revenue override audit failed:", auditErr.message);
    }

    res.json({ message: "Revenue tracking overrides saved", count: saved.length, overrides: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to save revenue tracking overrides", message: error instanceof Error ? error.message : "Failed to save revenue tracking overrides" });
  }
});

router.delete("/api/revenue-tracking/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deleteRevenueTrackingOverridesByProject(projectName);
    res.json({ message: `Revenue tracking overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete revenue tracking overrides", message: "Failed to delete revenue tracking overrides" });
  }
});

// ==================== REVENUE TAB ====================

router.get("/api/revenue-tab/:projectName", async (req, res) => {
  try {
    const projectName = req.params.projectName;

    const [rawInflows, overrides, projectInfoList, savedSummary, operationalTasks, planTasks, taskLinks] = await Promise.all([
      storage.getProgramInflowsByProject(projectName),
      storage.getRevenueTrackingOverridesByProject(projectName),
      storage.getAllProjectInfo(),
      storage.getProjectRevenueSummary(projectName),
      storage.getOperationalTasksByProject(projectName),
      storage.getProjectPlansByProject(projectName),
      storage.getMilestoneTaskLinks(projectName),
    ]);

    const inflows = applyRevenueTrackingOverrides(rawInflows, overrides);

    const isRealMilestone = (r: any) => {
      const no = r.milestoneNo;
      if (!no) return false;
      if (/^\d+$/.test(String(no).trim())) {
        const amt = parseFloat(r.milestoneAmount) || 0;
        const pct = parseFloat(r.milestonePercent) || 0;
        const name = (r.milestoneName || '').trim();
        if (name === '-' && amt === 0 && pct === 0) return false;
        return true;
      }
      return false;
    };

    const today = new Date().toISOString().split('T')[0];

    const milestones = inflows.filter(isRealMilestone).map((r: any) => {
      const hasInvoice = !!(r.milestoneInvoiceNumber && r.milestoneInvoiceNumber.trim());
      const manualInBank = r.inBank === 1 || r.inBank === '1' || r.inBank === true;
      const hasPaymentReceived = !!(r.paymentReceivedDate && r.paymentReceivedDate.trim() && r.paymentReceivedDate !== '-');
      const inBank = manualInBank || (hasPaymentReceived && hasInvoice);

      const date = r.paymentReceivedDate || r.plannedPaymentDate || null;
      const isConfirmed = inBank && hasInvoice;
      const isRed = !isConfirmed;
      const isPast = date ? date < today : false;

      let status: string;
      let flags: string[] = [];

      if (!isRed && hasInvoice) {
        status = 'inBank';
      } else if (isRed && hasInvoice) {
        status = 'invoiced';
        flags.push('Invoice raised, payment outstanding');
      } else if (isRed && !hasInvoice && isPast) {
        status = 'overdue';
        flags.push('Payment date has passed without invoice');
      } else {
        status = 'planned';
      }

      const hasOverride = overrides.some((o: any) => o.rowNumber === r.rowNumber);

      const link = taskLinks.find((l: any) => l.milestoneRowNumber === r.rowNumber);
      let linkedTask: any = null;
      if (link) {
        if (link.taskId > 0) {
          linkedTask = operationalTasks.find((t: any) => t.id === link.taskId);
        } else {
          const planTask = planTasks.find((pt: any) => pt.id === Math.abs(link.taskId));
          if (planTask) {
            const pctComplete = (planTask as any).actualPctComplete != null ? Math.round((planTask as any).actualPctComplete * 100) : 0;
            let taskStatus = "Not Started";
            if (pctComplete >= 100) taskStatus = "Done";
            else if (pctComplete > 0) taskStatus = "In Progress";
            linkedTask = {
              id: link.taskId,
              title: (planTask as any).highLevelProgramme || `Task ${(planTask as any).taskNo || (planTask as any).rowNumber}`,
              status: taskStatus,
              dueDate: (planTask as any).actualEnd || null,
            };
          }
        }
      }

      let effectiveDate = date;
      if (link?.dateOverride) {
        effectiveDate = link.dateOverride;
      } else if (linkedTask && linkedTask.dueDate) {
        effectiveDate = linkedTask.dueDate;
      }

      return {
        id: r.id,
        rowNumber: r.rowNumber,
        milestoneNo: r.milestoneNo,
        milestoneName: r.milestoneName,
        milestonePercent: r.milestonePercent,
        milestoneAmount: r.milestoneAmount,
        date: effectiveDate,
        isRed,
        milestoneInvoiceNumber: r.milestoneInvoiceNumber,
        invoiceRaisedDate: r.invoiceRaisedDate,
        inBank,
        status,
        flags,
        hasOverride,
        milestoneNotes: r.milestoneNotes,
        dependentTask: linkedTask ? { id: linkedTask.id, title: linkedTask.title, status: linkedTask.status, dueDate: linkedTask.dueDate } : null,
        dateOverride: link?.dateOverride || null,
        dateOverrideReason: link?.dateOverrideReason || null,
      };
    });

    const totalContract = milestones.reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const invoiced = milestones.filter((m: any) => m.status === 'invoiced').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const inBankTotal = milestones.filter((m: any) => m.status === 'inBank').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const pending = milestones.filter((m: any) => m.status === 'planned' || m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const overdueTotal = milestones.filter((m: any) => m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);

    const pInfo = projectInfoList.find((p: any) => p.projectName === projectName);
    const contractValue = pInfo ? parseFloat(String(pInfo.contractValue || '0')) : 0;

    let costedExpenditure = 0;
    let actualExpenditure = 0;
    let allExpenditure = 0;
    try {
      const expenseRows = await storage.getProgramExpensesByProject(projectName);
      for (const row of expenseRows) {
        if ((row as any).rowType === 'item') {
          costedExpenditure += parseFloat(String((row as any).budgetTotal || 0)) || 0;
          const actualAmt = parseFloat(String((row as any).expenseActualTotal || 0)) || 0;
          allExpenditure += actualAmt;
          const state = (row as any).computedState || classifyExpenseState(row as any);
          if (state === 'Paid' && actualAmt > 0) {
            actualExpenditure += actualAmt;
          }
        }
      }
    } catch (e) {}

    const plannedRevenue = savedSummary?.plannedRevenue ? parseFloat(String(savedSummary.plannedRevenue)) : (contractValue || totalContract);
    const plannedExpenditureVal = savedSummary?.plannedExpenditure ? parseFloat(String(savedSummary.plannedExpenditure)) : costedExpenditure;
    const plannedProfit = plannedRevenue - plannedExpenditureVal;
    const plannedMargin = plannedRevenue > 0 ? plannedProfit / plannedRevenue : 0;
    const costedExpenditureFinal = plannedExpenditureVal;

    const actualRevenue = inBankTotal;
    const actualProfit = actualRevenue - actualExpenditure;
    const actualMargin = actualRevenue > 0 ? actualProfit / actualRevenue : 0;

    const liveRevenue = totalContract;
    const liveExpenditure = allExpenditure;
    const liveProfit = liveRevenue - liveExpenditure;
    const liveMargin = liveRevenue > 0 ? liveProfit / liveRevenue : 0;

    res.json({
      milestones,
      summary: {
        totalContract,
        invoiced,
        inBank: inBankTotal,
        pending,
        overdue: overdueTotal,
        milestoneCount: milestones.length,
        issueCount: milestones.filter((m: any) => m.status === 'overdue' || m.status === 'invoiced' || !m.dependentTask).length,
      },
      highlevel: {
        costed: {
          revenue: plannedRevenue,
          expenditure: costedExpenditureFinal,
          profit: plannedProfit,
          margin: plannedMargin,
          isManualOverride: !!savedSummary?.plannedRevenue || !!savedSummary?.plannedExpenditure,
        },
        planned: {
          revenue: liveRevenue,
          expenditure: liveExpenditure,
          profit: liveProfit,
          margin: liveMargin,
        },
        actual: {
          revenue: actualRevenue,
          expenditure: actualExpenditure,
          profit: actualProfit,
          margin: actualMargin,
        },
        voPmLimit: null,
        currentVoTotal: null,
      },
    });
  } catch (error) {
    console.error("Revenue tab error:", error);
    res.status(500).json({ error: "Failed to fetch revenue tab data" });
  }
});

router.post("/api/revenue-tab/:projectName/costed", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const { revenue, expenditure } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isPmOnlyRole(userRole)) {
      const editSummary = `Costed values update: Revenue=${revenue || 'unchanged'}, Expenditure=${expenditure || 'unchanged'} [REVENUE IMPACT]`;
      const saved = await createPendingEditRequest(
        userId!,
        projectName,
        "costed_values",
        "revenue_costed",
        { revenue, expenditure },
        editSummary
      );
      return res.json({
        message: "Your costed values edit has been submitted for approval",
        status: "pending_approval",
        requestId: saved.id,
      });
    }

    const saved = await storage.upsertProjectRevenueSummary({
      projectName,
      plannedRevenue: revenue?.toString() ?? null,
      plannedExpenditure: expenditure?.toString() ?? null,
      plannedProfit: (revenue && expenditure) ? (parseFloat(revenue) - parseFloat(expenditure)).toString() : null,
      plannedMargin: (revenue && expenditure && parseFloat(revenue) > 0) ? ((parseFloat(revenue) - parseFloat(expenditure)) / parseFloat(revenue)).toString() : null,
      actualRevenue: null,
      actualExpenditure: null,
      actualProfit: null,
      actualMargin: null,
      voPmLimit: null,
      currentVoTotal: null,
    });
    res.json(saved);
  } catch (error) {
    console.error("Save costed error:", error);
    res.status(500).json({ error: "Failed to save costed values" });
  }
});

router.get("/api/revenue-tab/:projectName/task-alerts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const [tasks, inflows, taskLinks] = await Promise.all([
      storage.getOperationalTasksByProject(projectName),
      storage.getProgramInflowsByProject(projectName),
      storage.getMilestoneTaskLinks(projectName),
    ]);

    const alerts: any[] = [];
    for (const milestone of inflows) {
      if (!milestone.milestoneNo || !/^\d+$/.test(String(milestone.milestoneNo).trim())) continue;
      const name = (milestone.milestoneName || '').trim();
      if (name === '-') continue;

      const link = taskLinks.find((l: any) => l.milestoneRowNumber === milestone.rowNumber);
      const linkedTask = link ? tasks.find((t: any) => t.id === link.taskId) : null;

      if (linkedTask && ((linkedTask as any).status === 'complete' || (linkedTask as any).status === 'Complete') && !milestone.milestoneInvoiceNumber) {
        alerts.push({
          milestoneNo: milestone.milestoneNo,
          milestoneName: name,
          milestoneAmount: milestone.milestoneAmount,
          taskTitle: (linkedTask as any).title,
          taskId: (linkedTask as any).id,
          message: `Task "${(linkedTask as any).title}" is complete — invoice needs to be raised for milestone ${milestone.milestoneNo}`,
        });
      }
    }
    res.json(alerts);
  } catch (error) {
    console.error("Task alerts error:", error);
    res.status(500).json({ error: "Failed to fetch task alerts" });
  }
});

router.post("/api/revenue-tab/:projectName/link-task", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const { milestoneRowNumber, taskId } = req.body;
    if (!milestoneRowNumber || !taskId) {
      return res.status(400).json({ error: "milestoneRowNumber and taskId are required" });
    }
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isPmOnlyRole(userRole)) {
      const editSummary = `Link revenue milestone #${milestoneRowNumber} to task #${taskId} [REVENUE IMPACT]`;
      const saved = await createPendingEditRequest(
        userId!,
        projectName,
        "milestone_link",
        "revenue_task_link",
        { milestoneRowNumber, taskId },
        editSummary
      );
      return res.json({
        message: "Your milestone link request has been submitted for approval",
        status: "pending_approval",
        requestId: saved.id,
      });
    }

    const link = await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, taskId);
    res.json(link);
  } catch (error) {
    console.error("Link task error:", error);
    res.status(500).json({ error: "Failed to link task" });
  }
});

router.post("/api/revenue-tab/:projectName/date-override", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const { milestoneRowNumber, dateOverride, reason } = req.body;
    if (!milestoneRowNumber || !dateOverride) {
      return res.status(400).json({ error: "milestoneRowNumber and dateOverride are required" });
    }
    const existing = await storage.getMilestoneTaskLinks(projectName);
    const link = existing.find((l: any) => l.milestoneRowNumber === milestoneRowNumber);
    if (link) {
      const updated = await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, link.taskId);
      await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
      res.json({ success: true });
    } else {
      await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, 0);
      await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
      res.json({ success: true });
    }
  } catch (error) {
    console.error("Date override error:", error);
    res.status(500).json({ error: "Failed to save date override" });
  }
});

router.delete("/api/revenue-tab/:projectName/link-task/:milestoneRowNumber", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const milestoneRowNumber = parseInt(req.params.milestoneRowNumber);
    await storage.deleteMilestoneTaskLink(projectName, milestoneRowNumber);
    res.json({ success: true });
  } catch (error) {
    console.error("Unlink task error:", error);
    res.status(500).json({ error: "Failed to unlink task" });
  }
});

// ==================== EXPENDITURE OVERRIDES ====================

router.get("/api/expenditure/overrides", async (req, res) => {
  try {
    const { projectName } = req.query;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    const overrides = await storage.getExpenditureOverridesByProject(projectName);
    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch expenditure overrides", message: "Failed to fetch expenditure overrides" });
  }
});

router.post("/api/expenditure/overrides", requireAuth, requireAdminOrFinancialEditor, requirePermission('financials', 'edit'), async (req, res) => {
  try {
    const { overrides, overrideCategory, overrideComment } = req.body;
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
    }
    if (!overrideCategory || !OVERRIDE_CATEGORIES.includes(overrideCategory)) {
      return res.status(400).json({ error: "Override category is required. Must be one of: " + OVERRIDE_CATEGORIES.join(", ") });
    }
    if (!overrideComment || typeof overrideComment !== "string" || overrideComment.trim().length < 3) {
      return res.status(400).json({ error: "Override comment is required (min 3 characters)" });
    }
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isPmOnlyRole(userRole)) {
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
      const hasHighExpense = overrides.some((o: any) => o.fieldName === "expenseActualTotal" && Number(o.overrideValue) > 50000);
      const hasBudgetChange = overrides.some((o: any) => o.fieldName === "budgetTotal");
      const editSummary = `Expenditure override: ${overrides.length} field(s). Category: ${overrideCategory}. Comment: ${overrideComment.trim()}${hasHighExpense ? " [HIGH EXPENSE]" : ""}${hasBudgetChange ? " [BUDGET CHANGE]" : ""}`;
      const saved = await createPendingEditRequest(
        userId!,
        projectNames[0] || "Unknown",
        "expenditure_override",
        "expenditure_tracking",
        { overrides, overrideCategory, overrideComment },
        editSummary
      );
      return res.json({
        message: "Your expenditure edit has been submitted for approval",
        status: "pending_approval",
        requestId: saved.id,
      });
    }

    const overridesWithUser = overrides.map((o: any) => ({ ...o, createdBy: userId }));
    const saved = await storage.upsertManyExpenditureOverrides(overridesWithUser);

    const fieldToColumnMap: Record<string, string> = {
      expenseInvoicedDate: "expenseInvoicedDate",
      expensePaymentDate: "expensePaymentDate",
      expensePoNumber: "expensePoNumber",
      expenseInvoiceNumber: "expenseInvoiceNumber",
      expenseLineItem: "expenseLineItem",
      expenseActualTotal: "expenseActualTotal",
      budgetTotal: "budgetTotal",
      forecastPaymentDate: "forecastPaymentDate",
      expenseQty: "expenseQty",
      expenseRateUnit: "expenseRateUnit",
      budgetQty: "budgetQty",
      budgetRateUnit: "budgetRateUnit",
      invoiceDateFontColor: "invoiceDateFontColor",
      paymentDateFontColor: "paymentDateFontColor",
    };

    const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
    for (const pn of projectNames) {
      const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
      const expenses = await storage.getProgramExpensesByProject(pn as string);
      const rowMap = new Map(expenses.map((e: any) => [e.rowNumber, e]));

      const rowGroups = new Map<number, Record<string, any>>();
      for (const ov of projectOverrides) {
        const colName = fieldToColumnMap[ov.fieldName];
        if (!colName) continue;
        const expense = rowMap.get(ov.rowNumber);
        if (!expense) continue;
        if (!rowGroups.has(expense.id)) rowGroups.set(expense.id, {});
        const fields = rowGroups.get(expense.id)!;
        const effectiveValue = ov.overrideValue === "__null__" ? null : ov.overrideValue;
        fields[colName] = effectiveValue;
        if (ov.fieldName === 'expenseInvoicedDate' && effectiveValue) {
          fields.invoiceDateConfirmed = true;
        }
        if (ov.fieldName === 'expensePaymentDate' && effectiveValue) {
          fields.paymentDateConfirmed = true;
        }
      }

      for (const [expenseId, fields] of rowGroups.entries()) {
        await storage.updateProgramExpenseFields(expenseId, fields);
      }

      const { classifyExpenseState } = await import("../lib/calculations/stateClassifier");
      const { forecastExpensePaymentDate } = await import("../lib/calculations/forecaster");
      const updatedExpenses = await storage.getProgramExpensesByProject(pn as string);
      for (const exp of updatedExpenses) {
        if (!rowGroups.has(exp.id)) continue;
        const newState = classifyExpenseState(exp as any);
        const newForecast = forecastExpensePaymentDate(exp as any);
        await storage.updateProgramExpenseFields(exp.id, {
          computedState: newState,
          computedForecastPaymentDate: newForecast ?? null,
        });
      }
    }

    try {
      for (const o of overrides) {
        await recordOverride({
          actorUserId: userId,
          actorRole: (req as any).user?.role,
          entityType: "expenditure_override",
          entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
          projectName: o.projectName,
          action: "EXPENDITURE_OVERRIDE",
          overrideCategory,
          overrideComment: overrideComment.trim(),
          oldRecord: {},
          newRecord: { [o.fieldName]: o.overrideValue },
        });
      }
    } catch (auditErr: any) {
      console.warn("[audit] Expenditure override audit failed:", auditErr.message);
    }

    res.json({ message: "Expenditure overrides saved and applied", count: saved.length, overrides: saved });
  } catch (error) {
    console.error("Failed to save expenditure overrides:", error);
    res.status(500).json({ error: "Failed to save expenditure overrides", message: error instanceof Error ? error.message : "Failed to save expenditure overrides" });
  }
});

router.delete("/api/expenditure/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deleteExpenditureOverridesByProject(projectName);
    res.json({ message: `Expenditure overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete expenditure overrides", message: "Failed to delete expenditure overrides" });
  }
});

// ==================== EXPENSE TASK LINKS API ====================

router.get("/api/expense-task-links/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const links = await storage.getExpenseTaskLinks(req.params.projectName);
    res.json(links);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch expense task links" });
  }
});

router.post("/api/expense-task-links/:projectName", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const { expenseId, taskId } = req.body;
    if (!expenseId || taskId === undefined) {
      return res.status(400).json({ error: "expenseId and taskId are required" });
    }
    const link = await storage.upsertExpenseTaskLink(req.params.projectName, expenseId, taskId, (req.user as any)?.id);
    res.json(link);
  } catch (error) {
    console.error("Link expense task error:", error);
    res.status(500).json({ error: "Failed to link task" });
  }
});

router.delete("/api/expense-task-links/:projectName/:expenseId", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    await storage.deleteExpenseTaskLink(req.params.projectName, parseInt(req.params.expenseId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to unlink task" });
  }
});

router.post("/api/expense-task-links/:projectName/:expenseId/date-override", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const { dateOverride, reason } = req.body;
    await storage.updateExpenseTaskLinkDateOverride(req.params.projectName, parseInt(req.params.expenseId), dateOverride, reason);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to save date override" });
  }
});

// ==================== MANUAL EXPENSE ROWS API ====================

router.post("/api/expenses/add-line", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { projectName, expenseCategory, expenseLineItem, expenseActualTotal, expensePoNumber, expenseInvoiceNumber, expenseInvoicedDate, expensePaymentDate } = req.body;
    if (!projectName || !expenseCategory) {
      return res.status(400).json({ error: "projectName and expenseCategory are required" });
    }
    const maxRow = await storage.getProgramExpensesByProject(projectName);
    const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
    const newExpense = await storage.createManualExpense({
      projectName,
      rowNumber: maxRowNum + 1,
      rowType: 'item',
      expenseCategory,
      expenseLineItem: expenseLineItem || null,
      expenseActualTotal: expenseActualTotal || null,
      expensePoNumber: expensePoNumber || null,
      expenseInvoiceNumber: expenseInvoiceNumber || null,
      expenseInvoicedDate: expenseInvoicedDate || null,
      expensePaymentDate: expensePaymentDate || null,
      lineStatus: 'Planned',
    });
    res.json(newExpense);
  } catch (error) {
    console.error("Add expense line error:", error);
    res.status(500).json({ error: "Failed to add expense line item" });
  }
});

router.post("/api/expenses/add-category", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { projectName, categoryName } = req.body;
    if (!projectName || !categoryName) {
      return res.status(400).json({ error: "projectName and categoryName are required" });
    }
    const maxRow = await storage.getProgramExpensesByProject(projectName);
    const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
    const newCategory = await storage.createManualExpense({
      projectName,
      rowNumber: maxRowNum + 1,
      rowType: 'category',
      expenseCategory: categoryName,
      expenseLineItem: categoryName,
    });
    res.json(newCategory);
  } catch (error) {
    console.error("Add category error:", error);
    res.status(500).json({ error: "Failed to add category" });
  }
});

router.post("/api/expenses/insert-task-as-line", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { projectName, taskId, expenseCategory } = req.body;
    if (!projectName || !taskId || !expenseCategory) {
      return res.status(400).json({ error: "projectName, taskId, and expenseCategory are required" });
    }
    const [opTasks, planTasks] = await Promise.all([
      storage.getOperationalTasksByProject(projectName),
      storage.getProjectPlansByProject(projectName),
    ]);
    let taskTitle = '';
    let taskEndDate: string | null = null;
    if (taskId > 0) {
      const opTask = opTasks.find((t: any) => t.id === taskId);
      if (opTask) { taskTitle = opTask.title || ''; taskEndDate = opTask.dueDate || null; }
    } else {
      const planTask = planTasks.find((t: any) => t.id === Math.abs(taskId));
      if (planTask) { taskTitle = (planTask as any).highLevelProgramme || `Task ${(planTask as any).taskNo || ''}`; taskEndDate = (planTask as any).actualEnd || null; }
    }
    const maxRow = await storage.getProgramExpensesByProject(projectName);
    const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
    const newExpense = await storage.createManualExpense({
      projectName,
      rowNumber: maxRowNum + 1,
      rowType: 'item',
      expenseCategory,
      expenseLineItem: taskTitle,
      expensePaymentDate: taskEndDate,
      lineStatus: 'Planned',
    });
    await storage.upsertExpenseTaskLink(projectName, newExpense.id, taskId, (req.user as any)?.id);
    res.json(newExpense);
  } catch (error) {
    console.error("Insert task as line error:", error);
    res.status(500).json({ error: "Failed to insert task as line item" });
  }
});

// ==================== EXPENDITURE BREAKDOWN COMPOSITE API ====================

router.get("/api/expenditure-breakdown/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const [expenses, taskLinks, opTasks, planTasks, cosOverrides] = await Promise.all([
      storage.getProgramExpensesByProject(projectName),
      storage.getExpenseTaskLinks(projectName),
      storage.getOperationalTasksByProject(projectName),
      storage.getProjectPlansByProject(projectName),
      db.select().from(cosStatusOverrides).where(eq(cosStatusOverrides.projectName, projectName)),
    ]);

    const cosOverrideByExpenseId = new Map(cosOverrides.map(o => [o.expenseId, o]));
    const cosOverrideByRow = new Map(cosOverrides.map(o => [`${o.projectName}:${o.rowNumber}`, o]));

    const linkMap = new Map(taskLinks.map(l => [l.expenseId, l]));

    const enriched = expenses.filter((e: any) => e.rowType === 'item').map((exp: any) => {
      const link = linkMap.get(exp.id);
      let linkedTask: any = null;
      let taskCompleted = false;

      if (link) {
        if (link.taskId > 0) {
          const ot = opTasks.find((t: any) => t.id === link.taskId);
          if (ot) {
            linkedTask = { id: ot.id, title: ot.title, status: ot.status, dueDate: ot.dueDate, isBaseline: false };
            taskCompleted = ot.status === 'Complete' || ot.status === 'complete' || ot.status === 'Done';
          }
        } else {
          const pt = planTasks.find((t: any) => t.id === Math.abs(link.taskId));
          if (pt) {
            const pctComplete = (pt as any).actualPctComplete != null ? Math.round((pt as any).actualPctComplete * 100) : 0;
            let taskStatus = "Not Started";
            if (pctComplete >= 100) { taskStatus = "Done"; taskCompleted = true; }
            else if (pctComplete > 0) taskStatus = "In Progress";
            linkedTask = {
              id: link.taskId,
              title: (pt as any).highLevelProgramme || `Task ${(pt as any).taskNo || (pt as any).rowNumber}`,
              status: taskStatus,
              dueDate: (pt as any).actualEnd || null,
              isBaseline: true,
            };
          }
        }
      }

      const hasPO = !!(exp.expensePoNumber && exp.expensePoNumber.trim());
      const hasInvoice = !!(exp.expenseInvoiceNumber && exp.expenseInvoiceNumber.trim());
      const hasInvDate = !!(exp.expenseInvoicedDate && String(exp.expenseInvoicedDate).trim());
      const invoiceDateBlack = hasInvDate && (
        exp.invoiceDateConfirmed === true || exp.invoiceDateFontColor === 'black'
      );

      let cosStatus: string;
      if (hasPO && hasInvoice && invoiceDateBlack) {
        cosStatus = 'COS Realised';
      } else if (hasPO && hasInvoice && hasInvDate && !invoiceDateBlack) {
        cosStatus = 'Deferred';
      } else if (invoiceDateBlack && (!hasPO || !hasInvoice)) {
        cosStatus = 'Flagged';
      } else {
        cosStatus = 'Planned';
      }

      const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
      const paymentDateBlack = hasPayDate && (
        exp.paymentDateConfirmed === true || exp.paymentDateFontColor === 'black'
      );

      let paymentStatus: string;
      if (paymentDateBlack && hasInvoice) {
        paymentStatus = 'Out of Bank';
      } else if (hasPayDate && !paymentDateBlack) {
        paymentStatus = 'Payment Planned';
      } else {
        paymentStatus = 'Planned';
      }

      const effectivePaymentDate = link?.dateOverride || linkedTask?.dueDate || exp.expensePaymentDate || exp.forecastPaymentDate || null;
      let plannedMonth: string | null = null;
      if (effectivePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(effectivePaymentDate)) {
        const d = new Date(effectivePaymentDate);
        plannedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      const cosOverride = cosOverrideByExpenseId.get(exp.id) || cosOverrideByRow.get(`${exp.projectName}:${exp.rowNumber}`);

      return {
        ...exp,
        linkedTask,
        cosStatus: cosOverride ? cosOverride.overrideStatus : cosStatus,
        computedCosStatus: cosStatus,
        paymentStatus,
        effectivePaymentDate,
        plannedMonth,
        hasDateOverride: !!link?.dateOverride,
        dateOverrideReason: link?.dateOverrideReason || null,
        cosOverride: cosOverride ? { reason: cosOverride.reason, overriddenBy: cosOverride.overriddenBy, originalStatus: cosOverride.originalStatus, overrideStatus: cosOverride.overrideStatus } : null,
      };
    });

    const categories = [...new Set(expenses.filter((e: any) => e.rowType === 'category').map((e: any) => e.expenseCategory).filter(Boolean))];

    res.json({ items: enriched, categories });
  } catch (error) {
    console.error("Expenditure breakdown error:", error);
    res.status(500).json({ error: "Failed to fetch expenditure breakdown" });
  }
});

// ==================== FINANCE REVENUE OVERRIDES ====================

router.get("/api/finance/revenue/overrides", async (req, res) => {
  try {
    const { projectName } = req.query;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    const overrides = await storage.getFinanceRevenueOverridesByProject(projectName);
    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch finance revenue overrides", message: "Failed to fetch finance revenue overrides" });
  }
});

router.post("/api/finance/revenue/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
  try {
    const { overrides, overrideCategory, overrideComment } = req.body;
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
    }
    if (!overrideCategory || !OVERRIDE_CATEGORIES.includes(overrideCategory)) {
      return res.status(400).json({ error: "Override category is required. Must be one of: " + OVERRIDE_CATEGORIES.join(", ") });
    }
    if (!overrideComment || typeof overrideComment !== "string" || overrideComment.trim().length < 3) {
      return res.status(400).json({ error: "Override comment is required (min 3 characters)" });
    }
    const userId = req.user?.id;
    const overridesWithUser = overrides.map((o: any) => ({ ...o, createdBy: userId }));
    const saved = await storage.upsertManyFinanceRevenueOverrides(overridesWithUser);

    try {
      for (const o of overrides) {
        await recordOverride({
          actorUserId: userId, actorRole: (req as any).user?.role,
          entityType: "finance_revenue_override", entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
          projectName: o.projectName, action: "FINANCE_REVENUE_OVERRIDE",
          overrideCategory, overrideComment: overrideComment.trim(),
          oldRecord: {}, newRecord: { [o.fieldName]: o.overrideValue },
        });
      }
    } catch (auditErr: any) { console.warn("[audit] Finance revenue override audit failed:", auditErr.message); }

    res.json({ message: "Finance revenue overrides saved", count: saved.length, overrides: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to save finance revenue overrides", message: error instanceof Error ? error.message : "Failed to save finance revenue overrides" });
  }
});

router.delete("/api/finance/revenue/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deleteFinanceRevenueOverridesByProject(projectName);
    res.json({ message: `Finance revenue overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete finance revenue overrides", message: "Failed to delete finance revenue overrides" });
  }
});

// ==================== FINANCE COS OVERRIDES ====================

router.get("/api/finance/cos/overrides", async (req, res) => {
  try {
    const { projectName } = req.query;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    const overrides = await storage.getFinanceCosOverridesByProject(projectName);
    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch finance COS overrides", message: "Failed to fetch finance COS overrides" });
  }
});

router.post("/api/finance/cos/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
  try {
    const { overrides, overrideCategory, overrideComment } = req.body;
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
    }
    if (!overrideCategory || !OVERRIDE_CATEGORIES.includes(overrideCategory)) {
      return res.status(400).json({ error: "Override category is required. Must be one of: " + OVERRIDE_CATEGORIES.join(", ") });
    }
    if (!overrideComment || typeof overrideComment !== "string" || overrideComment.trim().length < 3) {
      return res.status(400).json({ error: "Override comment is required (min 3 characters)" });
    }
    const userId = req.user?.id;
    const overridesWithUser = overrides.map((o: any) => ({ ...o, createdBy: userId }));
    const saved = await storage.upsertManyFinanceCosOverrides(overridesWithUser);

    try {
      for (const o of overrides) {
        await recordOverride({
          actorUserId: userId, actorRole: (req as any).user?.role,
          entityType: "finance_cos_override", entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
          projectName: o.projectName, action: "FINANCE_COS_OVERRIDE",
          overrideCategory, overrideComment: overrideComment.trim(),
          oldRecord: {}, newRecord: { [o.fieldName]: o.overrideValue },
        });
      }
    } catch (auditErr: any) { console.warn("[audit] Finance COS override audit failed:", auditErr.message); }

    res.json({ message: "Finance COS overrides saved", count: saved.length, overrides: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to save finance COS overrides", message: error instanceof Error ? error.message : "Failed to save finance COS overrides" });
  }
});

router.delete("/api/finance/cos/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deleteFinanceCosOverridesByProject(projectName);
    res.json({ message: `Finance COS overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete finance COS overrides", message: "Failed to delete finance COS overrides" });
  }
});

// ==================== FINANCE REVENUE & COS DATA ====================

router.get("/api/finance/revenue", async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let data;

    if (projectName && typeof projectName === 'string') {
      data = await storage.getFinanceRevenueMonthlyByProject(projectName);

      if (applyOverrides === 'true') {
        const overrides = await storage.getFinanceRevenueOverridesByProject(projectName);
        data = applyFinanceRevenueOverrides(data, overrides);
      }
    } else {
      data = await storage.getAllFinanceRevenueMonthly();
    }

    if (startDate && typeof startDate === 'string') {
      data = data.filter(d => d.monthEndDate >= startDate);
    }
    if (endDate && typeof endDate === 'string') {
      data = data.filter(d => d.monthEndDate <= endDate);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch finance revenue data", message: "Failed to fetch finance revenue data" });
  }
});

router.get("/api/finance/cos", async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let data;

    if (projectName && typeof projectName === 'string') {
      data = await storage.getFinanceCosMonthlyByProject(projectName);

      if (applyOverrides === 'true') {
        const overrides = await storage.getFinanceCosOverridesByProject(projectName);
        data = applyFinanceCosOverrides(data, overrides);
      }
    } else {
      data = await storage.getAllFinanceCosMonthly();
    }

    if (startDate && typeof startDate === 'string') {
      data = data.filter(d => d.monthEndDate >= startDate);
    }
    if (endDate && typeof endDate === 'string') {
      data = data.filter(d => d.monthEndDate <= endDate);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch finance COS data", message: "Failed to fetch finance COS data" });
  }
});

// ==================== LEDGER ====================

router.get("/api/ledger", requireAuth, requireAdmin, async (req, res) => {
  try {
    const filters: any = {};
    if (req.query.runId) filters.runId = parseInt(req.query.runId as string);
    if (req.query.fileId) filters.fileId = parseInt(req.query.fileId as string);
    if (req.query.eventType) filters.eventType = req.query.eventType as string;
    if (req.query.importStatus) filters.importStatus = req.query.importStatus as string;
    const entries = await storage.getAllChangeLedger(filters);
    const files = await storage.getAllSpFiles();
    const fileMap = Object.fromEntries(files.map(f => [f.id, f]));
    const enriched = entries.map(e => ({
      ...e,
      fileName: fileMap[e.fileId]?.fileName || "Unknown",
      filePath: fileMap[e.fileId]?.path || null,
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/ledger/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const entry = await storage.getChangeLedgerEntry(parseInt(req.params.id));
    if (!entry) return res.status(404).json({ error: "Ledger entry not found" });
    const file = await storage.getSpFile(entry.fileId);
    let snapshot = null;
    if (entry.snapshotId) {
      snapshot = await storage.getSnapshot(entry.snapshotId);
      if (snapshot) {
        const metrics = await storage.getSnapshotMetrics(snapshot.id);
        (snapshot as any).metrics = metrics;
      }
    }
    res.json({ ...entry, file, snapshot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SNAPSHOTS ====================

router.get("/api/snapshots", requireAuth, requireAdmin, async (req, res) => {
  try {
    const fileId = req.query.fileId ? parseInt(req.query.fileId as string) : undefined;
    const snaps = await storage.getAllSnapshots(fileId);
    const files = await storage.getAllSpFiles();
    const fileMap = Object.fromEntries(files.map(f => [f.id, f]));
    const enriched = snaps.map(s => ({
      ...s,
      fileName: fileMap[s.fileId]?.fileName || "Unknown",
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/snapshots/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const snap = await storage.getSnapshot(parseInt(req.params.id));
    if (!snap) return res.status(404).json({ error: "Snapshot not found" });
    const metrics = await storage.getSnapshotMetrics(snap.id);
    const file = await storage.getSpFile(snap.fileId);

    let previousSnapshot = null;
    let previousMetrics: any[] = [];
    const allSnapshots = await storage.getAllSnapshots(snap.fileId);
    const sorted = allSnapshots
      .filter(s => s.id < snap.id)
      .sort((a, b) => b.id - a.id);
    if (sorted.length > 0) {
      previousSnapshot = sorted[0];
      previousMetrics = await storage.getSnapshotMetrics(previousSnapshot.id);
    }

    res.json({
      ...snap,
      file,
      metrics,
      previousSnapshot,
      previousMetrics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerFinanceRoutes(app: Express) {
  app.use(router);
}
