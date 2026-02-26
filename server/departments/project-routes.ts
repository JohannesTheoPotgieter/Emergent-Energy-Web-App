import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { requirePermission } from "../permission-middleware";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { OVERRIDE_CATEGORIES, users, projectInfo } from "@shared/schema";
import { eq } from "drizzle-orm";
import { recordOverride } from "../lib/audit/diff-engine";

const router = Router();

function applyProjectPlanOverrides(
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

function safeNum(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isWithinDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr);
  const diffMs = targetDate.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

function isThisWeek(dateStr: string | null | undefined): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = new Date();
  const target = new Date(dateStr);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return target >= monday && target <= sunday;
}

function isThisMonth(dateStr: string | null | undefined): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = new Date();
  const target = new Date(dateStr);
  return target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
}

function getFYRange(date: Date = new Date()): { start: string; end: string } {
  const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    start: `${year}-09-01`,
    end: `${year + 1}-08-31`
  };
}

function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const s = dateStr.substring(0, 10);
  return { year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)), day: parseInt(s.substring(8, 10)) };
}

function getSAPublicHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(formatDateKey(year, m, d));
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() === 0) {
      const next = new Date(dt);
      next.setUTCDate(next.getUTCDate() + 1);
      holidays.add(formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()));
    }
  };
  add(1, 1);
  add(3, 21);
  add(4, 27);
  add(5, 1);
  add(6, 16);
  add(8, 9);
  add(9, 24);
  add(12, 16);
  add(12, 25);
  add(12, 26);

  const easter = computeEaster(year);
  const goodFriday = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(formatDateKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));
  const familyDay = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  familyDay.setUTCDate(familyDay.getUTCDate() + 1);
  holidays.add(formatDateKey(familyDay.getUTCFullYear(), familyDay.getUTCMonth() + 1, familyDay.getUTCDate()));

  return holidays;
}

function computeEaster(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

const holidayCacheByYear = new Map<number, Set<string>>();
function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4));
  if (!holidayCacheByYear.has(year)) {
    holidayCacheByYear.set(year, getSAPublicHolidays(year));
  }
  return holidayCacheByYear.get(year)!.has(dateStr);
}

function saWorkingDays(startDateStr: string | null, endDateStr: string | null): number | null {
  if (!startDateStr || !endDateStr || !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)) return null;
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function findMaxEndDate(plans: any[], patterns: string[]): string | null {
  let maxDate: string | null = null;
  for (const task of plans) {
    const desc = (task.highLevelProgramme || '').toLowerCase();
    const matches = patterns.some(p => desc.includes(p.toLowerCase()));
    if (matches && task.actualEnd && /^\d{4}-\d{2}-\d{2}/.test(task.actualEnd)) {
      const dateStr = task.actualEnd.substring(0, 10);
      if (!maxDate || dateStr > maxDate) maxDate = dateStr;
    }
  }
  return maxDate;
}

function findMinStartDate(plans: any[], patterns: string[]): string | null {
  let minDate: string | null = null;
  for (const task of plans) {
    const desc = (task.highLevelProgramme || '').toLowerCase();
    const matches = patterns.some(p => desc.includes(p.toLowerCase()));
    if (matches && task.actualStart && /^\d{4}-\d{2}-\d{2}/.test(task.actualStart)) {
      const dateStr = task.actualStart.substring(0, 10);
      if (!minDate || dateStr < minDate) minDate = dateStr;
    }
  }
  return minDate;
}

function daysDiff(a: string | null, b: string | null): number | null {
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
  const da = new Date(a.substring(0, 10));
  const db2 = new Date(b.substring(0, 10));
  const diff = Math.round((da.getTime() - db2.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

// ==================== OVERVIEW API ====================

router.get("/api/overview", async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, allTaskLinks, allOpTasks] = await Promise.all([
      storage.getAllProjectInfo(),
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllProjectPlans(),
      storage.getLatestRefresh(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
    ]);

    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const today = new Date().toISOString().split("T")[0];

    let totalProgramBudget = 0;
    for (const info of allProjectInfo) {
      if (info.contractValue) {
        totalProgramBudget += parseFloat(info.contractValue);
      }
    }
    
    if (totalProgramBudget === 0) {
      for (const inflow of allInflows) {
        if (inflow.milestoneAmount) {
          totalProgramBudget += parseFloat(inflow.milestoneAmount);
        }
      }
    }

    let actualSpendPaid = 0;
    for (const expense of allExpenses) {
      const paymentDate = expense.expensePaymentDate;
      if (paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && paymentDate <= today && expense.expenseActualTotal) {
        actualSpendPaid += parseFloat(expense.expenseActualTotal);
      }
    }

    let revenueRealised = 0;
    for (const inflow of allInflows) {
      const paymentDate = inflow.effectiveDate;
      if (paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && paymentDate <= today && inflow.milestoneAmount) {
        revenueRealised += parseFloat(inflow.milestoneAmount);
      }
    }

    const uniqueProjects = new Set<string>();
    for (const info of allProjectInfo) {
      uniqueProjects.add(info.projectName);
    }
    for (const expense of allExpenses) {
      uniqueProjects.add(expense.projectName);
    }
    for (const inflow of allInflows) {
      uniqueProjects.add(inflow.projectName);
    }
    for (const plan of allPlans) {
      uniqueProjects.add(plan.projectName);
    }

    res.json({
      total_program_budget: totalProgramBudget,
      actual_spend_paid: actualSpendPaid,
      revenue_realised: revenueRealised,
      active_projects: uniqueProjects.size,
      data_as_of: new Date().toISOString()
    });
  } catch (error) {
    console.error("Overview fetch error:", error);
    res.status(500).json({ error: "Failed to fetch overview data", message: "Failed to fetch overview data" });
  }
});

// ==================== HOME PAGE API (Projects Report) ====================

router.get("/api/home/summary", async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, revenueSummaries, allTaskLinks, allOpTasks] = await Promise.all([
      storage.getAllProjectInfo(),
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllProjectPlans(),
      storage.getLatestRefresh(),
      storage.getAllProjectRevenueSummaries(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
    ]);
    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const today = new Date().toISOString().split("T")[0];
    const fyRange = getFYRange();

    const activeProjects = allProjectInfo.filter(p => 
      p.phase && !p.phase.toLowerCase().includes('closed') && !p.phase.toLowerCase().includes('hold')
    );
    const onHoldProjects = allProjectInfo.filter(p => 
      p.phase && p.phase.toLowerCase().includes('hold')
    );
    const closedProjects = allProjectInfo.filter(p => 
      p.phase && p.phase.toLowerCase().includes('closed')
    );
    const constructionProjects = allProjectInfo.filter(p => 
      p.phase && p.phase.toLowerCase() === 'construction'
    );

    let activeCapacityKw = 0;
    for (const p of activeProjects) {
      activeCapacityKw += safeNum(p.sizeKwp);
    }
    const activeCapacityMW = activeCapacityKw / 1000;

    let constructionCapacityKw = 0;
    for (const p of constructionProjects) {
      constructionCapacityKw += safeNum(p.sizeKwp);
    }

    const phaseDistribution: Record<string, { count: number; kw: number }> = {};
    for (const p of allProjectInfo) {
      const phase = p.phase || 'Unknown';
      if (!phaseDistribution[phase]) {
        phaseDistribution[phase] = { count: 0, kw: 0 };
      }
      phaseDistribution[phase].count++;
      phaseDistribution[phase].kw += safeNum(p.sizeKwp);
    }

    const projectDeltas = new Map<string, { weightedActual: number; weightedExpected: number; totalWeight: number; hasSummary: boolean }>();
    for (const plan of allPlans) {
      const taskNo = (plan.taskNo || '').toString().toLowerCase().trim();
      const isSummary = taskNo === 'no.' || taskNo === 'no' || taskNo === '#';
      if (isSummary && plan.actualPctComplete !== null && plan.expectedPctComplete !== null) {
        projectDeltas.set(plan.projectName, { 
          weightedActual: plan.actualPctComplete, 
          weightedExpected: plan.expectedPctComplete, 
          totalWeight: 1,
          hasSummary: true 
        });
      }
    }
    for (const plan of allPlans) {
      const taskNo2 = (plan.taskNo || '').toString().toLowerCase().trim();
      const isSummary2 = taskNo2 === 'no.' || taskNo2 === 'no' || taskNo2 === '#';
      if (isSummary2) continue;
      if (!projectDeltas.has(plan.projectName)) {
        projectDeltas.set(plan.projectName, { weightedActual: 0, weightedExpected: 0, totalWeight: 0, hasSummary: false });
      }
      const pd = projectDeltas.get(plan.projectName)!;
      if (!pd.hasSummary) {
        const dur = plan.durationDays && plan.durationDays > 0 ? plan.durationDays : 1;
        pd.weightedActual += (plan.actualPctComplete ?? 0) * dur;
        pd.weightedExpected += (plan.expectedPctComplete ?? 0) * dur;
        pd.totalWeight += dur;
      }
    }

    const projectDeltaValues: { projectName: string; delta: number; avgActual: number; avgExpected: number }[] = [];
    for (const [projectName, pd] of Array.from(projectDeltas.entries())) {
      if (pd.totalWeight > 0) {
        const avgActual = pd.hasSummary ? pd.weightedActual : pd.weightedActual / pd.totalWeight;
        const avgExpected = pd.hasSummary ? pd.weightedExpected : pd.weightedExpected / pd.totalWeight;
        const delta = (avgActual - avgExpected) * 100;
        projectDeltaValues.push({ projectName, delta, avgActual: avgActual * 100, avgExpected: avgExpected * 100 });
      }
    }

    const onScheduleProjects = projectDeltaValues.filter(p => p.delta >= 0);
    const behindPlanProjects = projectDeltaValues.filter(p => p.delta < 0);
    const onScheduleRate = projectDeltaValues.length > 0 
      ? (onScheduleProjects.length / projectDeltaValues.length) * 100 
      : 0;

    const top5BehindPlan = [...behindPlanProjects]
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5);

    const constructionProjectNames = new Set(constructionProjects.map(p => p.projectName));
    const constructionDeltas = projectDeltaValues.filter(p => constructionProjectNames.has(p.projectName));
    const avgConstructionComplete = constructionDeltas.length > 0
      ? constructionDeltas.reduce((sum, p) => sum + p.avgActual, 0) / constructionDeltas.length
      : 0;
    const avgConstructionDelta = constructionDeltas.length > 0
      ? constructionDeltas.reduce((sum, p) => sum + p.delta, 0) / constructionDeltas.length
      : 0;
    const constructionBehindCount = constructionDeltas.filter(p => p.delta < 0).length;

    const constructionStartSoon = allProjectInfo.filter(p => isWithinDays(p.constructionStartDate, 7)).length;
    const commissioningSoon = allProjectInfo.filter(p => isWithinDays(p.commissioningDate, 7)).length;
    const omHandoverSoon = allProjectInfo.filter(p => isWithinDays(p.omHandoverDate, 7)).length;
    const clientHandoverSoon = allProjectInfo.filter(p => isWithinDays(p.clientHandoverDate, 7)).length;

    const commissioningDue30 = allProjectInfo.filter(p => isWithinDays(p.commissioningDate, 30)).length;
    const omHandoverDue30 = allProjectInfo.filter(p => isWithinDays(p.omHandoverDate, 30)).length;
    const clientHandoverDue30 = allProjectInfo.filter(p => isWithinDays(p.clientHandoverDate, 30)).length;

    let actualRevenue = 0, actualExpenses = 0, currentVoTotal = 0;
    
    const hasRevenueSummaryData = revenueSummaries.length > 0;
    if (hasRevenueSummaryData) {
      for (const rs of revenueSummaries) {
        actualRevenue += safeNum(rs.actualRevenue);
        actualExpenses += safeNum(rs.actualExpenditure);
        currentVoTotal += safeNum(rs.currentVoTotal);
      }
    } else {
      for (const inflow of allInflows) {
        if (inflow.milestoneAmount) {
          actualRevenue += safeNum(inflow.milestoneAmount);
        }
      }
      for (const expense of allExpenses) {
        if (expense.expenseActualTotal) {
          actualExpenses += safeNum(expense.expenseActualTotal);
        }
      }
    }
    const grossProfit = actualRevenue - actualExpenses;
    const grossProfitPercent = actualRevenue > 0 ? (grossProfit / actualRevenue) * 100 : 0;

    let revenueOutstanding = 0;
    for (const inf of allInflows) {
      if (inf.invoiceRaisedDate && !inf.paymentReceivedDate && inf.milestoneAmount) {
        revenueOutstanding += safeNum(inf.milestoneAmount);
      }
    }

    let expensesOutstanding = 0;
    for (const exp of allExpenses) {
      if (exp.expenseInvoicedDate && !exp.expensePaymentDate && exp.expenseActualTotal) {
        expensesOutstanding += safeNum(exp.expenseActualTotal);
      }
    }

    let weeklyInflows = 0, weeklyOutflows = 0;
    for (const inf of allInflows) {
      if (isThisWeek(inf.effectiveDate) && inf.milestoneAmount) {
        weeklyInflows += safeNum(inf.milestoneAmount);
      }
    }
    for (const exp of allExpenses) {
      if (isThisWeek(exp.expensePaymentDate) && exp.expenseActualTotal) {
        weeklyOutflows += safeNum(exp.expenseActualTotal);
      }
    }

    let monthlyRevOutstanding = 0, monthlyCosOutstanding = 0;
    for (const inf of allInflows) {
      if (inf.invoiceRaisedDate && !inf.paymentReceivedDate && isThisMonth(inf.invoiceRaisedDate) && inf.milestoneAmount) {
        monthlyRevOutstanding += safeNum(inf.milestoneAmount);
      }
    }
    for (const exp of allExpenses) {
      if (exp.expenseInvoicedDate && !exp.expensePaymentDate && isThisMonth(exp.expenseInvoicedDate) && exp.expenseActualTotal) {
        monthlyCosOutstanding += safeNum(exp.expenseActualTotal);
      }
    }

    const missingPhase = allProjectInfo.filter(p => !p.phase).length;
    const missingKwp = allProjectInfo.filter(p => !p.sizeKwp || safeNum(p.sizeKwp) === 0).length;
    const missingCommissioning = allProjectInfo.filter(p => !p.commissioningDate).length;

    res.json({
      lastRefresh: latestRefresh?.refreshedAt || null,
      fyRange,
      portfolio: {
        activeProjects: activeProjects.length,
        activeCapacityMW,
        onScheduleRate,
        projectsBehindPlan: behindPlanProjects.length,
        contractPackComplete: null,
        onHold: onHoldProjects.length,
        closed: closedProjects.length,
        phaseDistribution: Object.entries(phaseDistribution).map(([phase, data]) => ({
          phase,
          count: data.count,
          kw: data.kw
        }))
      },
      upcomingEvents: {
        constructionStart: constructionStartSoon,
        commissioning: commissioningSoon,
        omHandover: omHandoverSoon,
        clientHandover: clientHandoverSoon
      },
      execution: {
        constructionProjects: constructionProjects.length,
        executionCapacityKw: constructionCapacityKw,
        avgPercentComplete: avgConstructionComplete,
        avgDeltaVsExpected: avgConstructionDelta,
        behindSchedule: constructionBehindCount,
        commissioningDue30,
        omHandoverDue30,
        clientHandoverDue30
      },
      top5BehindPlan,
      financial: {
        actualRevenue,
        actualExpenses,
        grossProfit,
        grossProfitPercent,
        revenueOutstanding,
        expensesOutstanding,
        currentVoTotal,
        thisWeek: {
          inflows: weeklyInflows,
          outflows: weeklyOutflows,
          net: weeklyInflows - weeklyOutflows
        },
        thisMonth: {
          revenueOutstanding: monthlyRevOutstanding,
          cosOutstanding: monthlyCosOutstanding
        }
      },
      dataQuality: {
        missingPhase,
        missingKwp,
        missingCommissioning,
        projectCount: allProjectInfo.length,
        expenseCount: allExpenses.length,
        inflowCount: allInflows.length,
        planCount: allPlans.length,
        lastUpload: latestRefresh?.refreshedAt || null
      }
    });
  } catch (error) {
    console.error("Home summary error:", error);
    res.status(500).json({ error: "Failed to fetch home summary" });
  }
});

router.get("/api/home/notes", async (req, res) => {
  try {
    const notes = await storage.getHomeNotes();
    res.json(notes || { highlightsNotes: '', constructionNotes: '', financeNotes: '', preparedBy: '' });
  } catch (error) {
    console.error("Home notes fetch error:", error);
    res.status(500).json({ error: "Failed to fetch home notes" });
  }
});

router.post("/api/home/notes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { preparedBy, highlightsNotes, constructionNotes, financeNotes } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const result = await storage.saveHomeNotes({
      reportDate: today,
      preparedBy: preparedBy || null,
      highlightsNotes: highlightsNotes || null,
      constructionNotes: constructionNotes || null,
      financeNotes: financeNotes || null
    });
    res.json(result);
  } catch (error) {
    console.error("Home notes save error:", error);
    res.status(500).json({ error: "Failed to save home notes" });
  }
});

// ==================== PROJECTS SUMMARY API ====================

router.get("/api/projects-summary", async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, allEditableFields, allTaskLinks, allOpTasks, uploadMetaRows] = await Promise.all([
      storage.getAllProjectInfo(),
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllProjectPlans(),
      storage.getAllProjectEditableFields(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      db.execute(sql`SELECT DISTINCT file_name FROM upload_metadata`),
    ]);
    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const importedProjectNames = new Set<string>();
    for (const row of uploadMetaRows.rows) {
      const fileName = (row as any).file_name as string;
      if (!fileName) continue;
      const stripped = fileName.replace(/\.(xlsx|xlsm|xls)$/i, '');
      importedProjectNames.add(stripped);
      importedProjectNames.add(stripped.replace(/ /g, '_'));
    }

    const today = new Date().toISOString().split("T")[0];

    const expensesByProject = new Map<string, typeof allExpenses>();
    for (const expense of allExpenses) {
      if (!expensesByProject.has(expense.projectName)) expensesByProject.set(expense.projectName, []);
      expensesByProject.get(expense.projectName)!.push(expense);
    }

    const inflowsByProject = new Map<string, typeof allInflows>();
    for (const inflow of allInflows) {
      if (!inflowsByProject.has(inflow.projectName)) inflowsByProject.set(inflow.projectName, []);
      inflowsByProject.get(inflow.projectName)!.push(inflow);
    }

    const plansByProject = new Map<string, typeof allPlans>();
    for (const plan of allPlans) {
      if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
      plansByProject.get(plan.projectName)!.push(plan);
    }

    const editableMap = new Map(allEditableFields.map(f => [f.projectName, f]));

    const allProjectNames = new Set<string>();
    for (const info of allProjectInfo) allProjectNames.add(info.projectName);
    for (const expense of allExpenses) allProjectNames.add(expense.projectName);
    for (const inflow of allInflows) allProjectNames.add(inflow.projectName);
    for (const plan of allPlans) allProjectNames.add(plan.projectName);

    const taskCountsByProject = new Map<string, Record<string, number>>();
    for (const task of allOpTasks) {
      const rawName = task.projectName;
      const trackerName = rawName.replace(/ /g, "_") + (rawName.endsWith("_Tracker") ? "" : "_Tracker");
      const key = allProjectNames.has(trackerName) ? trackerName : rawName;
      if (!taskCountsByProject.has(key)) taskCountsByProject.set(key, {});
      const counts = taskCountsByProject.get(key)!;
      const status = task.status || "TO DO";
      counts[status] = (counts[status] || 0) + 1;
    }

    const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

    const projectsSummary = Array.from(allProjectNames).map(projectName => {
      const info = projectInfoMap.get(projectName);
      const projectExpenses = expensesByProject.get(projectName) || [];
      const projectInflows = inflowsByProject.get(projectName) || [];
      const projectPlans = plansByProject.get(projectName) || [];
      const editable = editableMap.get(projectName);

      const pdFromPlan = findMaxEndDate(projectPlans, ['bd handover', 'project charter handover']);
      const csFromPlan = findMinStartDate(projectPlans, ['site establishment']);
      const commFromPlan = findMaxEndDate(projectPlans, ['commissioning']);
      const omFromPlan = findMaxEndDate(projectPlans, ['handover to matriarch']);
      const chFromPlan = findMaxEndDate(projectPlans, ['handover to client']);

      const pdHandoverDate = pdFromPlan || info?.pdHandoverDate || null;
      const constructionStartDate = csFromPlan || info?.constructionStartDate || null;
      const commissioningDate = commFromPlan || info?.commissioningDate || null;
      const omHandoverDate = omFromPlan || info?.omHandoverDate || null;
      const clientHandoverDate = chFromPlan || info?.clientHandoverDate || null;

      const dateSources = {
        pd_handover: pdFromPlan ? 'plan' : (info?.pdHandoverDate ? 'info' : 'none'),
        construction_start: csFromPlan ? 'plan' : (info?.constructionStartDate ? 'info' : 'none'),
        commissioning: commFromPlan ? 'plan' : (info?.commissioningDate ? 'info' : 'none'),
        om_handover: omFromPlan ? 'plan' : (info?.omHandoverDate ? 'info' : 'none'),
        client_handover: chFromPlan ? 'plan' : (info?.clientHandoverDate ? 'info' : 'none'),
      };

      const duration = saWorkingDays(constructionStartDate, clientHandoverDate);

      const sizeKwp = info?.sizeKwp ? parseFloat(info.sizeKwp) : null;
      const commWorkDays = saWorkingDays(constructionStartDate, commissioningDate);
      const workingWeeks = commWorkDays ? commWorkDays / 5 : null;
      const kwPerWeek = (sizeKwp && workingWeeks && workingWeeks > 0) ? sizeKwp / workingWeeks : null;

      let actualRevenue = 0;
      for (const inflow of projectInflows) {
        if (inflow.milestoneAmount) actualRevenue += parseFloat(inflow.milestoneAmount);
      }

      let actualExpenses = 0;
      for (const expense of projectExpenses) {
        if (expense.expenseActualTotal) actualExpenses += parseFloat(expense.expenseActualTotal);
      }

      const gpPercent = actualRevenue > 0 ? 1 - (actualExpenses / actualRevenue) : null;

      const summaryRow = projectPlans.find(p => {
        const tn = (p.taskNo || '').toString().toLowerCase().trim();
        return tn === 'no.' || tn === 'no' || tn === '#';
      });
      let projectPctComplete: number | null = null;
      let expectedPctComplete: number | null = null;
      if (summaryRow) {
        projectPctComplete = summaryRow.actualPctComplete ?? null;
        expectedPctComplete = summaryRow.expectedPctComplete ?? null;
      }
      if (projectPctComplete === null) {
        let totalWeight = 0;
        let weightedSum = 0;
        for (const p of projectPlans) {
          const dur = p.durationDays && p.durationDays > 0 ? p.durationDays : 1;
          weightedSum += (p.actualPctComplete ?? 0) * dur;
          totalWeight += dur;
        }
        projectPctComplete = totalWeight > 0 ? weightedSum / totalWeight : null;
      }
      if (expectedPctComplete === null) {
        const todayDate = today;
        let totalExpWeight = 0;
        let weightedExpSum = 0;
        for (const task of projectPlans) {
          const dur = task.durationDays && task.durationDays > 0 ? task.durationDays : 1;
          if (task.expectedPctComplete !== null && task.expectedPctComplete !== undefined) {
            weightedExpSum += task.expectedPctComplete * dur;
            totalExpWeight += dur;
            continue;
          }
          const tStart = task.actualStart?.substring(0, 10);
          const tEnd = task.actualEnd?.substring(0, 10);
          if (!tStart || !tEnd || !/^\d{4}-\d{2}-\d{2}/.test(tStart) || !/^\d{4}-\d{2}-\d{2}/.test(tEnd)) continue;
          let exp = 0;
          if (todayDate >= tEnd) {
            exp = 1.0;
          } else if (todayDate <= tStart) {
            exp = 0.0;
          } else {
            const totalWd = saWorkingDays(tStart, tEnd);
            const elapsedWd = saWorkingDays(tStart, todayDate);
            if (totalWd && totalWd > 0 && elapsedWd !== null) {
              exp = Math.min(elapsedWd / totalWd, 1.0);
            }
          }
          weightedExpSum += exp * dur;
          totalExpWeight += dur;
        }
        expectedPctComplete = totalExpWeight > 0 ? weightedExpSum / totalExpWeight : null;
      }
      const deltaVsExpected = (projectPctComplete !== null && expectedPctComplete !== null)
        ? projectPctComplete - expectedPctComplete : null;

      let revenueOutstanding = 0;
      for (const inflow of projectInflows) {
        if (inflow.milestoneAmount) {
          const hasPayment = inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inflow.paymentReceivedDate) && inflow.paymentReceivedDate <= today;
          const noInvoice = !inflow.milestoneInvoiceNumber || inflow.milestoneInvoiceNumber.trim() === '';
          if (hasPayment && noInvoice) {
            revenueOutstanding += parseFloat(inflow.milestoneAmount);
          }
        }
      }

      let expensesDue = 0;
      for (const expense of projectExpenses) {
        if (expense.expenseActualTotal) {
          const hasPastPaymentDate = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(expense.expensePaymentDate) && expense.expensePaymentDate < today;
          const noInvoice = !expense.expenseInvoiceNumber || expense.expenseInvoiceNumber.trim() === '';
          if (hasPastPaymentDate && noInvoice) {
            expensesDue += parseFloat(expense.expenseActualTotal);
          }
        }
      }

      return {
        project_info_id: info?.id || null,
        project_name: projectName,
        size_kwp: sizeKwp,
        pd: info?.pd || null,
        pm: info?.pm || null,
        cost_proposal_signed: editable?.costProposalSigned || null,
        cost_proposal_type: editable?.costProposalType || null,
        cost_proposal_link: editable?.costProposalLink || null,
        cost_proposal_na_reason: editable?.costProposalNaReason || null,
        funding_signed: editable?.fundingSigned || null,
        funding_type: editable?.fundingType || null,
        funding_link: editable?.fundingLink || null,
        funding_na_reason: editable?.fundingNaReason || null,
        epc_contract_signed: editable?.epcContractSigned || null,
        epc_contract_type: editable?.epcContractType || null,
        epc_contract_link: editable?.epcContractLink || null,
        epc_contract_na_reason: editable?.epcContractNaReason || null,
        financial_close_achieved: !!(
          (editable?.costProposalType === 'link' || editable?.costProposalType === 'na') &&
          (editable?.fundingType === 'link' || editable?.fundingType === 'na') &&
          (editable?.epcContractType === 'link' || editable?.epcContractType === 'na')
        ),
        phase: info?.executionPhase || info?.phase || null,
        pd_handover_date: pdHandoverDate,
        construction_start_date: constructionStartDate,
        duration,
        kw_per_week: kwPerWeek,
        commissioning_date: commissioningDate,
        om_handover_date: omHandoverDate,
        client_handover_date: clientHandoverDate,
        date_sources: dateSources,
        project_pct_complete: projectPctComplete,
        expected_pct_complete: expectedPctComplete,
        delta_vs_expected: deltaVsExpected,
        actual_revenue: actualRevenue,
        actual_expenses: actualExpenses,
        gp_percent: gpPercent,
        revenue_outstanding: revenueOutstanding,
        expenses_due: expensesDue,
        current_vo_total: editable?.currentVoTotal ? parseFloat(editable.currentVoTotal) : 0,
        comments: editable?.comments || null,
        latest_update: editable?.latestUpdate || null,
        latest_update_at: editable?.latestUpdateAt || null,
        latest_update_by: editable?.latestUpdateBy || null,
        escalation_level: info?.escalationLevel || null,
        task_status_counts: taskCountsByProject.get(projectName) || {},
        phase_updated_at: info?.phaseUpdatedAt || null,
        has_tracker_import: importedProjectNames.has(projectName) || importedProjectNames.has(projectName.replace(/_/g, ' ')),
        is_active: info?.isActive !== false && info?.phase?.toLowerCase() !== "gone",
      };
    });

    res.json(projectsSummary);
  } catch (error) {
    console.error("Projects summary fetch error:", error);
    res.status(500).json({ error: "Failed to fetch projects summary", message: "Failed to fetch projects summary" });
  }
});

router.post("/api/projects-summary/:projectName/edit", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const editSchema = z.object({
      costProposalSigned: z.string().nullable().optional(),
      fundingSigned: z.string().nullable().optional(),
      epcContractSigned: z.string().nullable().optional(),
      costProposalType: z.enum(["link", "na"]).nullable().optional(),
      costProposalLink: z.string().nullable().optional(),
      costProposalNaReason: z.string().nullable().optional(),
      fundingType: z.enum(["link", "na"]).nullable().optional(),
      fundingLink: z.string().nullable().optional(),
      fundingNaReason: z.string().nullable().optional(),
      epcContractType: z.enum(["link", "na"]).nullable().optional(),
      epcContractLink: z.string().nullable().optional(),
      epcContractNaReason: z.string().nullable().optional(),
      currentVoTotal: z.union([z.string(), z.number()]).nullable().optional(),
      comments: z.string().nullable().optional(),
    }).strict();
    const parsed = editSchema.parse(req.body);
    const data: Record<string, any> = { projectName };
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'currentVoTotal') {
        data[key] = value != null ? String(value) : null;
      } else {
        data[key] = value ?? null;
      }
    }
    const result = await storage.upsertProjectEditableFields(data as any);
    res.json(result);
  } catch (error) {
    console.error("Project edit error:", error);
    res.status(500).json({ error: "Failed to save project fields", message: "Failed to save project fields" });
  }
});

router.patch("/api/projects-summary/:projectName/latest-update", requireAuth, async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const schema = z.object({
      latestUpdate: z.string().nullable(),
    });
    const { latestUpdate } = schema.parse(req.body);
    const roleName = (req as any).user?.name || (req as any).user?.role || "Unknown";
    const data: Record<string, any> = {
      projectName,
      latestUpdate: latestUpdate || null,
      latestUpdateAt: latestUpdate ? new Date() : null,
      latestUpdateBy: latestUpdate ? roleName : null,
    };
    const result = await storage.upsertProjectEditableFields(data as any);
    res.json(result);
  } catch (error) {
    console.error("Latest update error:", error);
    res.status(500).json({ error: "Failed to save latest update" });
  }
});

router.patch("/api/projects-summary/:projectInfoId/escalation", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.projectInfoId as string);
    const schema = z.object({
      escalationLevel: z.enum(["None", "Low", "Medium", "High", "Highest"]).nullable(),
    });
    const { escalationLevel } = schema.parse(req.body);
    const result = await storage.updateProjectInfoById(id, { escalationLevel });
    res.json(result);
  } catch (error) {
    console.error("Escalation update error:", error);
    res.status(500).json({ error: "Failed to update escalation level" });
  }
});

// ==================== PROGRAM DASHBOARD ====================

router.get("/api/program-dashboard", requireAuth, async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, allEditableFields, allTaskLinks, allOpTasks, manualEntries] = await Promise.all([
      storage.getAllProjectInfo(),
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllProjectPlans(),
      storage.getAllProjectEditableFields(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getTrackerMonthlyManual('COS'),
    ]);
    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const today = new Date().toISOString().split("T")[0];

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

    const manualMap = new Map(manualEntries.map(e => [e.monthKey, e]));
    const cosRealisedByMonth = new Map<string, number>();
    const cosTotalByMonth = new Map<string, number>();

    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      cosTotalByMonth.set(monthKey, (cosTotalByMonth.get(monthKey) || 0) + amount);

      const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
      const hasInvDate = !!(exp.expenseInvoicedDate && String(exp.expenseInvoicedDate).trim());
      const dateConfirmed = hasInvDate && (
        exp.invoiceDateConfirmed === true ||
        (exp as any).invoiceDateFontColor === 'black' ||
        (!(exp as any).invoiceDateFontColor || (exp as any).invoiceDateFontColor === '')
      );
      if (hasInvoice && dateConfirmed) {
        cosRealisedByMonth.set(monthKey, (cosRealisedByMonth.get(monthKey) || 0) + amount);
      }
    }

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;
    const cosStartMonth = new Date(Date.UTC(2025, 8, 1));

    let cosYtdTarget = 0;
    let cosYtdRealised = 0;
    let cosYtdBudget = 0;
    let cosCurrentMonthRealised = 0;
    let cosCurrentMonthTarget = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(cosStartMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const mk = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const monthTotal = cosTotalByMonth.get(mk) || 0;
      const monthRealised = cosRealisedByMonth.get(mk) || 0;
      cosYtdTarget += monthTotal;
      cosYtdRealised += monthRealised;

      const manual = manualMap.get(mk);
      const budget = manual?.budget ? parseFloat(manual.budget) : (staticCosBudget[mk] ?? 0);
      cosYtdBudget += budget;

      if (mk === currentMonthKey) {
        cosCurrentMonthRealised = monthRealised;
        cosCurrentMonthTarget = monthTotal;
      }
    }

    const plansByProject = new Map<string, typeof allPlans>();
    for (const plan of allPlans) {
      if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
      plansByProject.get(plan.projectName)!.push(plan);
    }

    const inflowsByProject = new Map<string, typeof allInflows>();
    for (const inflow of allInflows) {
      if (!inflowsByProject.has(inflow.projectName)) inflowsByProject.set(inflow.projectName, []);
      inflowsByProject.get(inflow.projectName)!.push(inflow);
    }

    const expensesByProject = new Map<string, typeof allExpenses>();
    for (const expense of allExpenses) {
      if (!expensesByProject.has(expense.projectName)) expensesByProject.set(expense.projectName, []);
      expensesByProject.get(expense.projectName)!.push(expense);
    }

    const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

    const allProjectNames = new Set<string>();
    for (const info of allProjectInfo) allProjectNames.add(info.projectName);
    for (const expense of allExpenses) allProjectNames.add(expense.projectName);
    for (const inflow of allInflows) allProjectNames.add(inflow.projectName);
    for (const plan of allPlans) allProjectNames.add(plan.projectName);

    let siteEstablishmentNext10 = 0;
    let commissioningNext10 = 0;
    let omHandoverNext10 = 0;
    let clientHandoverNext10 = 0;
    let revenueOutstanding = 0;
    let expenseOverdue = 0;
    let inflowsThisWeek = 0;
    let outflowsThisWeek = 0;

    const siteEstablishmentProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
    const commissioningProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
    const omHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
    const clientHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
    const revenueOutstandingProjects: Array<{ projectName: string; amount: number; milestone: string | null }> = [];
    const expenseOverdueProjects: Array<{ projectName: string; amount: number; lineItem: string | null; hasInvoice: boolean }> = [];
    const inflowProjects: Array<{ projectName: string; amount: number }> = [];
    const outflowProjects: Array<{ projectName: string; amount: number }> = [];

    const pmStats = new Map<string, { activeProjects: number; commissioningThisMonth: number; clientHandoverThisMonth: number }>();

    for (const projectName of Array.from(allProjectNames)) {
      const info = projectInfoMap.get(projectName);
      const projectPlans = plansByProject.get(projectName) || [];
      const projectInflows = inflowsByProject.get(projectName) || [];
      const projectExpenses = expensesByProject.get(projectName) || [];

      const constructionStartDate = findMinStartDate(projectPlans, ['site establishment']) || info?.constructionStartDate || null;
      const commissioningDate = findMaxEndDate(projectPlans, ['commissioning']) || info?.commissioningDate || null;
      const omHandoverDate = findMaxEndDate(projectPlans, ['handover to matriarch']) || info?.omHandoverDate || null;
      const clientHandoverDate = findMaxEndDate(projectPlans, ['handover to client']) || info?.clientHandoverDate || null;

      if (isWithinDays(constructionStartDate, 10)) {
        siteEstablishmentNext10++;
        siteEstablishmentProjects.push({ projectName, date: constructionStartDate!, pm: info?.pm || null });
      }
      if (isWithinDays(commissioningDate, 10)) {
        commissioningNext10++;
        commissioningProjects.push({ projectName, date: commissioningDate!, pm: info?.pm || null });
      }
      if (isWithinDays(omHandoverDate, 10)) {
        omHandoverNext10++;
        omHandoverProjects.push({ projectName, date: omHandoverDate!, pm: info?.pm || null });
      }
      if (isWithinDays(clientHandoverDate, 10)) {
        clientHandoverNext10++;
        clientHandoverProjects.push({ projectName, date: clientHandoverDate!, pm: info?.pm || null });
      }

      let projRevOutstanding = 0;
      for (const inflow of projectInflows) {
        if (inflow.milestoneAmount) {
          const amt = parseFloat(inflow.milestoneAmount);
          const hasInvoiceNum = inflow.milestoneInvoiceNumber && inflow.milestoneInvoiceNumber.trim() !== '';
          const paymentNotReceived = !inflow.paymentReceivedDate || inflow.paymentReceivedDate.trim() === '';
          const dateToCheck = inflow.effectiveDate || inflow.invoiceRaisedDate;
          const dateInPast = dateToCheck && /^\d{4}-\d{2}-\d{2}/.test(dateToCheck) && dateToCheck < today;
          if (hasInvoiceNum && paymentNotReceived && dateInPast && amt > 0) {
            revenueOutstanding += amt;
            projRevOutstanding += amt;
          }
        }
        if (isThisWeek(inflow.effectiveDate) && inflow.milestoneAmount) {
          inflowsThisWeek += parseFloat(inflow.milestoneAmount);
        }
      }
      if (projRevOutstanding > 0) {
        revenueOutstandingProjects.push({ projectName, amount: projRevOutstanding, milestone: null });
      }

      let projInflowsWeek = 0;
      let projOutflowsWeek = 0;
      for (const inflow of projectInflows) {
        if (isThisWeek(inflow.effectiveDate) && inflow.milestoneAmount) {
          projInflowsWeek += parseFloat(inflow.milestoneAmount);
        }
      }
      if (projInflowsWeek > 0) {
        inflowProjects.push({ projectName, amount: projInflowsWeek });
      }

      let projExpOverdue = 0;
      let projHasInvoice = false;
      for (const expense of projectExpenses) {
        if (expense.expenseActualTotal) {
          const amt = parseFloat(expense.expenseActualTotal);
          const hasPastPaymentDate = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}$/.test(expense.expensePaymentDate) && expense.expensePaymentDate < today;
          const state = expense.computedState || '';
          const isOverdueState = state === 'Invoiced' || state === 'Committed';
          if (hasPastPaymentDate && amt > 0 && isOverdueState) {
            expenseOverdue += amt;
            projExpOverdue += amt;
            if (expense.expenseInvoiceNumber && expense.expenseInvoiceNumber.trim() !== '') {
              projHasInvoice = true;
            }
          }
        }
        if (isThisWeek(expense.expensePaymentDate) && expense.expenseActualTotal) {
          projOutflowsWeek += parseFloat(expense.expenseActualTotal);
        }
      }
      if (projExpOverdue > 0) {
        expenseOverdueProjects.push({ projectName, amount: projExpOverdue, lineItem: null, hasInvoice: projHasInvoice });
      }
      outflowsThisWeek += projOutflowsWeek;
      if (projOutflowsWeek > 0) {
        outflowProjects.push({ projectName, amount: projOutflowsWeek });
      }

      const pm = info?.pm;
      if (pm) {
        if (!pmStats.has(pm)) pmStats.set(pm, { activeProjects: 0, commissioningThisMonth: 0, clientHandoverThisMonth: 0 });
        const stats = pmStats.get(pm)!;
        if (clientHandoverDate && clientHandoverDate >= today) {
          stats.activeProjects++;
        }
        if (isThisMonth(commissioningDate)) {
          stats.commissioningThisMonth++;
        }
        if (isThisMonth(clientHandoverDate)) {
          stats.clientHandoverThisMonth++;
        }
      }
    }

    const pmTable = Array.from(pmStats.entries()).map(([pm, stats]) => ({
      pm,
      ...stats,
    }));

    const phaseCountMap = new Map<string, number>();
    for (const info of allProjectInfo) {
      const phase = info.phase && info.phase.trim() !== '' ? info.phase : '(blank)';
      phaseCountMap.set(phase, (phaseCountMap.get(phase) || 0) + 1);
    }
    const PHASE_LIFECYCLE_ORDER = [
      "DLP", "Financial Close", "Planning", "Construction", "QA",
      "Handover", "Commercial Close Out", "Compliance Handover", "Hold"
    ];
    const projectsByPhase = Array.from(phaseCountMap.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => {
        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const ai = PHASE_LIFECYCLE_ORDER.findIndex(p => normalize(p) === normalize(a.phase));
        const bi = PHASE_LIFECYCLE_ORDER.findIndex(p => normalize(p) === normalize(b.phase));
        const aIdx = ai !== -1 ? ai : PHASE_LIFECYCLE_ORDER.length;
        const bIdx = bi !== -1 ? bi : PHASE_LIFECYCLE_ORDER.length;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return b.count - a.count;
      });

    const constructionQAPhases = new Set<string>();
    for (const info of allProjectInfo) {
      if (info.phase) {
        const lower = info.phase.toLowerCase();
        if (lower.includes('construction') || lower.includes('qa') || lower.includes('quality')) {
          constructionQAPhases.add(info.projectName);
        }
      }
    }
    const hasPhaseData = allProjectInfo.some(i => i.phase && i.phase.trim() !== '');

    const completionCompare: Array<{ projectName: string; actualPct: number; expectedPct: number }> = [];
    for (const [projectName, plans] of Array.from(plansByProject.entries())) {
      if (hasPhaseData && !constructionQAPhases.has(projectName)) continue;
      const withData = plans.filter((p: any) => p.percentComplete != null && p.expectedProgress != null);
      if (withData.length === 0) continue;
      const actualPct = withData.reduce((sum: number, p: any) => sum + (parseFloat(p.percentComplete) || 0), 0) / withData.length;
      const expectedPct = withData.reduce((sum: number, p: any) => sum + (parseFloat(p.expectedProgress) || 0), 0) / withData.length;
      completionCompare.push({ projectName, actualPct, expectedPct });
    }
    completionCompare.sort((a, b) => b.actualPct - a.actualPct);

    const portfolioTimeline: Array<{ projectName: string; startDate: string | null; endDate: string | null; phase: string | null }> = [];
    for (const projectName of Array.from(allProjectNames)) {
      const info = projectInfoMap.get(projectName);
      const projectPlans = plansByProject.get(projectName) || [];
      const projectExps = expensesByProject.get(projectName) || [];

      const csFromPlan = findMinStartDate(projectPlans, ['site establishment']);
      const planMinStart = projectPlans.reduce((min: string | null, p: any) => {
        const d = p.actualStart?.substring(0, 10);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '1950-01-01') return min;
        return !min || d < min ? d : min;
      }, null as string | null);
      const planMaxEnd = projectPlans.reduce((max: string | null, p: any) => {
        const d = p.actualEnd?.substring(0, 10);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '1950-01-01') return max;
        return !max || d > max ? d : max;
      }, null as string | null);

      const startDate = csFromPlan || info?.constructionStartDate || planMinStart || null;
      if (!startDate || startDate < '1950-01-01') continue;

      const commFromPlan = findMaxEndDate(projectPlans, ['commissioning']);
      const chFromPlan = findMaxEndDate(projectPlans, ['handover to client']);
      const endDate = chFromPlan || info?.clientHandoverDate || commFromPlan || info?.commissioningDate || planMaxEnd || null;

      portfolioTimeline.push({
        projectName,
        startDate,
        endDate: endDate && endDate >= startDate ? endDate : startDate,
        phase: info?.phase || null,
      });
    }
    portfolioTimeline.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    res.json({
      kpis: {
        siteEstablishmentNext10,
        commissioningNext10,
        omHandoverNext10,
        clientHandoverNext10,
        revenueOutstanding,
        expenseOverdue,
        inflowsThisWeek,
        outflowsThisWeek,
      },
      cosKpis: {
        currentMonthRealised: cosCurrentMonthRealised,
        currentMonthTarget: cosCurrentMonthTarget,
        currentMonthRealisedPct: cosCurrentMonthTarget !== 0 ? cosCurrentMonthRealised / cosCurrentMonthTarget : 0,
        ytdRealised: cosYtdRealised,
        ytdTarget: cosYtdTarget,
        ytdRealisedPct: cosYtdTarget !== 0 ? cosYtdRealised / cosYtdTarget : 0,
        ytdBudget: cosYtdBudget,
      },
      kpiDetails: {
        siteEstablishmentProjects,
        commissioningProjects,
        omHandoverProjects,
        clientHandoverProjects,
        revenueOutstandingProjects: revenueOutstandingProjects.sort((a, b) => b.amount - a.amount),
        expenseOverdueProjects: expenseOverdueProjects.sort((a, b) => b.amount - a.amount),
        inflowProjects: inflowProjects.sort((a, b) => b.amount - a.amount),
        outflowProjects: outflowProjects.sort((a, b) => b.amount - a.amount),
      },
      pmTable,
      projectsByPhase,
      completionCompare,
      portfolioTimeline,
    });
  } catch (error) {
    console.error("Program dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch program dashboard", message: "Failed to fetch program dashboard" });
  }
});

// ==================== DASHBOARD HIGH PRIORITY ====================

router.get("/api/dashboard/high-priority", requireAuth, async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, allTaskLinks, allOpTasks] = await Promise.all([
      storage.getAllProjectInfo(),
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getAllProjectPlans(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
    ]);

    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const today = new Date().toISOString().split("T")[0];
    const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

    const overdueExpenses: Array<{
      id: number;
      projectName: string;
      lineItem: string | null;
      invoiceNumber: string | null;
      poNumber: string | null;
      amount: number;
      paymentDate: string;
      severity: string;
      hasInvoice: boolean;
    }> = [];

    for (const expense of allExpenses) {
      if (expense.expenseActualTotal && expense.expensePaymentDate) {
        const amt = parseFloat(expense.expenseActualTotal);
        const state = expense.computedState || '';
        if (amt > 0 && expense.expensePaymentDate < today && (state === 'Invoiced' || state === 'Committed')) {
          overdueExpenses.push({
            id: expense.id,
            projectName: expense.projectName,
            lineItem: expense.expenseLineItem,
            invoiceNumber: expense.expenseInvoiceNumber,
            poNumber: expense.expensePoNumber,
            amount: amt,
            paymentDate: expense.expensePaymentDate,
            severity: amt >= 500000 ? "Critical" : amt >= 100000 ? "High" : "Medium",
            hasInvoice: !!expense.expenseInvoiceNumber && expense.expenseInvoiceNumber.trim() !== '',
          });
        }
      }
    }
    overdueExpenses.sort((a, b) => b.amount - a.amount);

    const revenueOutstanding: Array<{
      id: number;
      projectName: string;
      milestoneName: string | null;
      invoiceNumber: string | null;
      amount: number;
      dueDate: string | null;
      severity: string;
    }> = [];

    for (const inflow of allInflows) {
      if (inflow.milestoneAmount) {
        const amt = parseFloat(inflow.milestoneAmount);
        const hasInvoiceNum = inflow.milestoneInvoiceNumber && inflow.milestoneInvoiceNumber.trim() !== '';
        const paymentNotReceived = !inflow.paymentReceivedDate || inflow.paymentReceivedDate.trim() === '';
        const dateToCheck = inflow.effectiveDate || inflow.invoiceRaisedDate;
        const dateInPast = dateToCheck && /^\d{4}-\d{2}-\d{2}/.test(dateToCheck) && dateToCheck < today;
        if (amt > 0 && hasInvoiceNum && paymentNotReceived && dateInPast) {
          revenueOutstanding.push({
            id: inflow.id,
            projectName: inflow.projectName,
            milestoneName: inflow.milestoneName,
            invoiceNumber: inflow.milestoneInvoiceNumber,
            amount: amt,
            dueDate: dateToCheck || null,
            severity: amt >= 1000000 ? "Critical" : amt >= 250000 ? "High" : "Medium",
          });
        }
      }
    }
    revenueOutstanding.sort((a, b) => b.amount - a.amount);

    const projectsBehindPlan: Array<{
      projectName: string;
      phase: string | null;
      pm: string | null;
      delta: number;
      avgActual: number;
      avgExpected: number;
      severity: string;
    }> = [];

    const plansByProject = new Map<string, typeof allPlans>();
    for (const plan of allPlans) {
      if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
      plansByProject.get(plan.projectName)!.push(plan);
    }

    for (const [projectName, plans] of Array.from(plansByProject.entries())) {
      const completions = plans.filter((p: any) => p.percentComplete != null && p.expectedProgress != null);
      if (completions.length > 0) {
        let totalW = 0, wActual = 0, wExpected = 0;
        for (const p of completions as any[]) {
          const dur = p.durationDays && p.durationDays > 0 ? p.durationDays : 1;
          wActual += (parseFloat(p.percentComplete) || 0) * dur;
          wExpected += (parseFloat(p.expectedProgress) || 0) * dur;
          totalW += dur;
        }
        const avgActual = totalW > 0 ? wActual / totalW : 0;
        const avgExpected = totalW > 0 ? wExpected / totalW : 0;
        const delta = avgActual - avgExpected;
        if (delta < -0.05) {
          const info = projectInfoMap.get(projectName);
          projectsBehindPlan.push({
            projectName,
            phase: info?.phase || null,
            pm: info?.pm || null,
            delta,
            avgActual,
            avgExpected,
            severity: delta < -0.2 ? "Critical" : delta < -0.1 ? "High" : "Medium",
          });
        }
      }
    }
    projectsBehindPlan.sort((a, b) => a.delta - b.delta);

    const upcomingMilestones: Array<{
      projectName: string;
      milestoneType: string;
      date: string;
      pm: string | null;
      amount: number;
    }> = [];

    for (const inflow of allInflows) {
      const amt = inflow.milestoneAmount ? parseFloat(inflow.milestoneAmount) : 0;
      if (amt <= 0) continue;
      const paymentReceived = inflow.paymentReceivedDate && inflow.paymentReceivedDate.trim() !== '';
      if (paymentReceived) continue;
      const effectiveDate = (inflow as any).effectiveDate || inflow.plannedPaymentDate;
      if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}/.test(effectiveDate)) continue;
      if (effectiveDate < today) continue;
      const info = projectInfoMap.get(inflow.projectName);
      upcomingMilestones.push({
        projectName: inflow.projectName,
        milestoneType: inflow.milestoneName || `Milestone ${inflow.milestoneNo || ''}`.trim(),
        date: effectiveDate,
        pm: info?.pm || null,
        amount: amt,
      });
    }
    upcomingMilestones.sort((a, b) => a.date.localeCompare(b.date));

    const overdueTasks: Array<{
      id: number;
      projectName: string;
      taskName: string;
      endDate: string;
      percentComplete: number;
      expectedProgress: number | null;
    }> = [];

    for (const plan of allPlans) {
      if (plan.actualEnd && /^\d{4}-\d{2}-\d{2}/.test(plan.actualEnd)) {
        const endDate = plan.actualEnd.substring(0, 10);
        if (endDate < today) {
          const pctComplete = plan.actualPctComplete != null ? Number(plan.actualPctComplete) : 0;
          if (pctComplete < 1.0) {
            overdueTasks.push({
              id: plan.id,
              projectName: plan.projectName,
              taskName: plan.highLevelProgramme || plan.taskNo || `Task #${plan.id}`,
              endDate,
              percentComplete: Math.round(pctComplete * 100),
              expectedProgress: plan.expectedPctComplete != null ? Math.round(Number(plan.expectedPctComplete) * 100) : null,
            });
          }
        }
      }
    }
    overdueTasks.sort((a, b) => b.endDate > a.endDate ? -1 : 1);

    res.json({
      overdueExpenses: overdueExpenses.slice(0, 15),
      revenueOutstanding: revenueOutstanding.slice(0, 15),
      projectsBehindPlan: projectsBehindPlan.slice(0, 10),
      upcomingMilestones,
      overdueTasks: overdueTasks.slice(0, 20),
    });
  } catch (error) {
    console.error("High priority API error:", error);
    res.status(500).json({ error: "Failed to fetch high priority items" });
  }
});

// ==================== DASHBOARD DATA ROUTES ====================

router.get("/api/dashboard", async (req, res) => {
  try {
    const [projects, expenses, revenues, tasks, latestRefresh] = await Promise.all([
      storage.getAllProjects(),
      storage.getAllExpenses(),
      storage.getAllRevenues(),
      storage.getAllTasks(),
      storage.getLatestRefresh()
    ]);

    const budgets = await storage.getAllBudgets();

    res.json({
      projects,
      expenses,
      revenues,
      tasks,
      budgets,
      lastRefresh: latestRefresh?.refreshedAt?.toISOString() || null
    });
  } catch (error) {
    console.error("Dashboard fetch error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data", message: "Failed to fetch dashboard data" });
  }
});

// ==================== PROJECTS ROUTES ====================

router.get("/api/projects", async (req, res) => {
  try {
    const projects = await storage.getAllProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch projects", message: "Failed to fetch projects" });
  }
});

router.get("/api/projects/:id", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const project = await storage.getProject(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found", message: "Project not found" });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project", message: "Failed to fetch project" });
  }
});

// ==================== PROJECT PLANS ====================

router.get("/api/project-plans", async (req, res) => {
  try {
    const { projectName, applyOverrides } = req.query;
    let plans;
    
    if (projectName && typeof projectName === 'string') {
      plans = await storage.getProjectPlansByProject(projectName);
      
      if (applyOverrides === 'true') {
        const overrides = await storage.getProjectPlanOverridesByProject(projectName);
        plans = applyProjectPlanOverrides(plans, overrides);
      }
      return res.json(plans);
    }
    plans = await storage.getAllProjectPlans();
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project plans", message: "Failed to fetch project plans" });
  }
});

router.get("/api/project-plan/:projectName", async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const { applyOverrides } = req.query;
    
    let plans = await storage.getProjectPlansByProject(projectName);
    
    if (applyOverrides === 'true') {
      const overrides = await storage.getProjectPlanOverridesByProject(projectName);
      plans = applyProjectPlanOverrides(plans, overrides);
    }
    
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project plan", message: "Failed to fetch project plan", code: "PROJECT_PLAN_ERROR" });
  }
});

// ==================== PROJECT INFO ====================

router.get("/api/project-info", async (req, res) => {
  try {
    const info = await storage.getAllProjectInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project info", message: "Failed to fetch project info" });
  }
});

router.get("/api/pm-assignable-users", requireAuth, async (_req, res) => {
  try {
    const pmUsers = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
    }).from(users).where(eq(users.role, "PROJECT_MANAGER_SITE"));
    res.json(pmUsers.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role })));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/api/pd-assignable-users", requireAuth, async (_req, res) => {
  try {
    const pdUsers = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
    }).from(users).where(eq(users.role, "PROJECT_DEVELOPER"));
    res.json(pdUsers.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role })));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/api/project-info/:id/assign-pm", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

    const schema = z.object({
      pm: z.string().min(1),
      pmUserId: z.number().nullable().optional(),
    });
    const { pm, pmUserId } = schema.parse(req.body);

    const updated = await storage.updateProjectInfoById(id, { pm } as any);
    if (!updated) return res.status(404).json({ error: "Project not found" });

    if (pmUserId) {
      await db.update(projectInfo).set({ pmUserId }).where(eq(projectInfo.id, id));
    }

    res.json(updated);
  } catch (error) {
    console.error("PM assignment error:", error);
    res.status(500).json({ error: "Failed to assign PM" });
  }
});

router.patch("/api/project-info/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

    const editSchema = z.object({
      projectName: z.string().min(1).optional(),
      phase: z.string().nullable().optional(),
      executionPhase: z.string().nullable().optional(),
      pd: z.string().nullable().optional(),
      pm: z.string().nullable().optional(),
      sizeKwp: z.string().nullable().optional(),
      contractValue: z.string().nullable().optional(),
      constructionStartDate: z.string().nullable().optional(),
      commissioningDate: z.string().nullable().optional(),
      omHandoverDate: z.string().nullable().optional(),
      clientHandoverDate: z.string().nullable().optional(),
      pdHandoverDate: z.string().nullable().optional(),
    });

    const parsed = editSchema.parse(req.body);
    const updated = await storage.updateProjectInfoById(id, parsed as any);
    if (!updated) return res.status(404).json({ error: "Project not found" });
    res.json(updated);
  } catch (error) {
    console.error("Project info update error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Failed to update project info" });
  }
});

// ==================== PROJECT PLAN OVERRIDES ====================

router.get("/api/project-plan/overrides", async (req, res) => {
  try {
    const { projectName } = req.query;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    const overrides = await storage.getProjectPlanOverridesByProject(projectName);
    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project plan overrides", message: "Failed to fetch project plan overrides" });
  }
});

router.post("/api/project-plan/overrides", requireAuth, requireAdmin, async (req, res) => {
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
    const saved = await storage.upsertManyProjectPlanOverrides(overridesWithUser);

    try {
      for (const o of overrides) {
        await recordOverride({
          actorUserId: userId,
          actorRole: (req as any).user?.role,
          entityType: "project_plan_override",
          entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
          projectName: o.projectName,
          action: "PROJECT_PLAN_OVERRIDE",
          overrideCategory,
          overrideComment: overrideComment.trim(),
          oldRecord: {},
          newRecord: { [o.fieldName]: o.overrideValue },
        });
      }
    } catch (auditErr: any) {
      console.warn("[audit] Project plan override audit failed:", auditErr.message);
    }

    res.json({ message: "Project plan overrides saved", count: saved.length, overrides: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to save project plan overrides", message: error instanceof Error ? error.message : "Failed to save project plan overrides" });
  }
});

router.delete("/api/project-plan/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deleteProjectPlanOverridesByProject(projectName);
    res.json({ message: `Project plan overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete project plan overrides", message: "Failed to delete project plan overrides" });
  }
});

// ==================== KEY DATE MAPPINGS ====================

router.get("/api/key-date-mappings/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mappings = await storage.getKeyDateMappings(decodeURIComponent(req.params.projectName));
    res.json(mappings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/key-date-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mapping = await storage.createKeyDateMapping({ ...req.body, createdBy: (req.user as any)?.id });
    res.json(mapping);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateKeyDateMapping(parseInt(req.params.id), req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await storage.deleteKeyDateMapping(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/key-dates/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName);
    const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";

    const [planTasksDirect, planTasksTracker] = await Promise.all([
      storage.getProjectPlansByProject(projectName),
      projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
    ]);

    const planTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;

    const autoMappings = [
      { keyDateName: "PD Handover", patterns: ['bd handover', 'project charter handover'], dateField: 'actualEnd' as const, sortOrder: 1 },
      { keyDateName: "Construction Start", patterns: ['site establishment'], dateField: 'actualStart' as const, sortOrder: 2 },
      { keyDateName: "Commissioning", patterns: ['commissioning'], dateField: 'actualEnd' as const, sortOrder: 3 },
      { keyDateName: "Practical Completion", patterns: ['practical completion'], dateField: 'actualEnd' as const, sortOrder: 4 },
      { keyDateName: "O&M Handover", patterns: ['handover to matriarch'], dateField: 'actualEnd' as const, sortOrder: 5 },
      { keyDateName: "Client Handover", patterns: ['handover to client'], dateField: 'actualEnd' as const, sortOrder: 6 },
    ];

    const results = autoMappings.map(mapping => {
      let matchedTask: any = null;
      let effectiveDate: string | null = null;

      for (const task of planTasks) {
        const desc = (task.highLevelProgramme || '').toLowerCase();
        const matches = mapping.patterns.some(p => desc.includes(p));
        if (matches) {
          const dateVal = mapping.dateField === 'actualStart' ? task.actualStart : task.actualEnd;
          if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
            const dateStr = dateVal.substring(0, 10);
            if (mapping.dateField === 'actualStart') {
              if (!effectiveDate || dateStr < effectiveDate) {
                effectiveDate = dateStr;
                matchedTask = task;
              }
            } else {
              if (!effectiveDate || dateStr > effectiveDate) {
                effectiveDate = dateStr;
                matchedTask = task;
              }
            }
          }
        }
      }

      const plannedStart = matchedTask?.baselineStart?.substring(0, 10) || null;
      const plannedEnd = matchedTask?.baselineEnd?.substring(0, 10) || null;
      const plannedDate = mapping.dateField === 'actualStart' ? plannedStart : plannedEnd;

      return {
        id: mapping.sortOrder,
        keyDateName: mapping.keyDateName,
        sourceTaskNameMatch: mapping.patterns.join(' / '),
        dateField: mapping.dateField === 'actualStart' ? 'startDate' : 'dueDate',
        sortOrder: mapping.sortOrder,
        matchedTaskId: matchedTask?.id || null,
        matchedTaskTitle: matchedTask?.highLevelProgramme || null,
        matchedTaskNumber: matchedTask?.taskNo || null,
        plannedDate,
        actualDate: effectiveDate,
        effectiveDate,
        mappingValid: !!matchedTask,
        source: 'auto',
      };
    });

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerProjectRoutes(app: Express) {
  app.use(router);
}
