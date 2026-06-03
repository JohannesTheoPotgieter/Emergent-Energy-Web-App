import { Router, type Express, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db, getDbMode } from "../db";
import { requirePermission } from "../permission-middleware";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { OVERRIDE_CATEGORIES, projectInfo, projectExecutionState } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { UsersRepository } from "../repositories/users-repository";
import { ProjectInfoRepository } from "../repositories/project-info-repository";

const usersRepository = new UsersRepository();
const projectInfoRepository = new ProjectInfoRepository();
import { recordOverride } from "../lib/audit/diff-engine";
import { classifyExpenseState, isDateBlack } from "../lib/calculations/stateClassifier";
import { isCosRealised, classifyCosStatusFull } from "../lib/calculations/financeUtils";
import { getCosEffectiveDateAndSource } from "../lib/expense-row-selector";
import {
  recognitionAmountFor,
  sumRevenueRecognition,
  sumRealisedRevenueRecognition,
} from "../lib/finance/revenue-recognition";
import { isEffectivelyRealised } from "../lib/finance/cos-realisation";
import { buildCanonicalResolver } from "../services/project-summary-helpers";
import { getProjectHeaderKpis, recomputeHeaderKpiProjectionForActiveProjects } from "../services/project-header-kpi-service";
import { evaluateRevenueArStatus } from "../lib/finance/revenue-ar-status";
import { getCanonicalAllCurrentCostLines } from "../services/project-cost-line-read-service";
import { parseIntParam } from "../lib/req-params";
import { computeProjectProgress } from "../lib/kpi-formulas";
import { computeAllProjectPlanPills } from "../services/plan-rollup-service";

/**
 * Helper: derive the COS month-key (YYYY-MM, UTC anchor) for a cost line.
 * Used by canonical Revenue Recognition aggregation so that the realised
 * gate uses the same month bucketing as the COS Tracker.
 */
function cosMonthKeyForLine(line: any): string | null {
  const { date } = getCosEffectiveDateAndSource(line);
  return date ? date.substring(0, 7) : null;
}

/** Current month key in UTC (YYYY-MM). */
function currentMonthKeyUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const router = Router();

// ─── Read-only BI feed (Phase 3) ───────────────────────────────────────────
// Lets Power BI / Excel / Looker pull live portfolio KPIs without a login.
// OFF by default: disabled unless a strong BI_FEED_TOKEN (>=16 chars) is set,
// so it exposes nothing until the COO deliberately enables it. Read-only,
// KPI-only (no PII), constant-time token compare.
function requireBiToken(req: Request, res: Response, next: () => void) {
  const configured = process.env.BI_FEED_TOKEN;
  if (!configured || configured.length < 16) {
    return res.status(404).json({ error: "bi_feed_disabled" });
  }
  const provided = String(req.header("x-bi-token") || req.query.token || "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// permission-skip: token-gated BI feed (BI_FEED_TOKEN service token) — read-only, off unless configured, not an RBAC entity.
router.get("/api/bi/projects", requireBiToken, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        projectCode: projectInfo.projectCode,
        pd: projectInfo.pd,
        pm: projectInfo.pm,
        sizeKwp: projectInfo.sizeKwp,
        contractValue: projectInfo.contractValue,
        deliveryModel: projectInfo.deliveryModel,
        projectStatus: projectInfo.projectStatus,
        inDlp: projectInfo.inDlp,
        phase: projectExecutionState.phase,
        executionPhase: projectExecutionState.executionPhase,
        ragStatus: projectExecutionState.ragStatus,
        escalationLevel: projectExecutionState.escalationLevel,
      })
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(sql`${projectInfo.deletedAt} IS NULL`);
    res.json({ generatedAt: new Date().toISOString(), count: rows.length, projects: rows });
  } catch (error) {
    console.error("[bi-feed] error:", error);
    res.status(500).json({ error: "server_error" });
  }
});

const NUMERIC_PLAN_FIELDS = new Set(["actualPctComplete", "expectedPctComplete", "durationDays"]);

function coercePlanOverride(fieldName: string, value: any): any {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC_PLAN_FIELDS.has(fieldName)) {
    const num = Number(value);
    return isNaN(num) ? null : num;
  }
  return value;
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
      effectiveDate: inf.adminDateOverride || inf.paymentReceivedDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate || null,
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
    // Admin date override takes highest priority
    if (inf.adminDateOverride && /^\d{4}-\d{2}-\d{2}/.test(inf.adminDateOverride)) {
      return { ...inf, effectiveDate: inf.adminDateOverride };
    }

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

router.get("/api/overview", requireAuth, async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, allTaskLinks, allOpTasks] = await Promise.all([
      storage.getAllProjectInfo(),
      getCanonicalAllCurrentCostLines(),
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
        totalProgramBudget += parseFloat(info.contractValue) || 0;
      }
    }
    
    if (totalProgramBudget === 0) {
      for (const inflow of allInflows) {
        if (inflow.milestoneAmount) {
          totalProgramBudget += parseFloat(inflow.milestoneAmount) || 0;
        }
      }
    }

    let actualSpendPaid = 0;
    for (const expense of allExpenses) {
      const paymentDate = expense.expensePaymentDate;
      if (paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && paymentDate <= today && expense.expenseActualTotal) {
        actualSpendPaid += parseFloat(expense.expenseActualTotal) || 0;
      }
    }

    // CANONICAL Revenue Recognition (POC method).
    // Source: normalized_cost_lines.revenue_recognition_amount on lines whose
    // underlying COS is effectively realised. NOT cash inflows.
    const cmkOv = currentMonthKeyUtc();
    const revenueRealised = sumRealisedRevenueRecognition(
      allExpenses as any,
      cmkOv,
      cosMonthKeyForLine,
    );
    const revenuePlannedOv = sumRevenueRecognition(allExpenses as any);

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
      revenue_planned: revenuePlannedOv,
      revenue_method: "POC",
      active_projects: uniqueProjects.size,
      data_as_of: new Date().toISOString()
    });
  } catch (error) {
    console.error("Overview fetch error:", error);
    res.status(500).json({ error: "Failed to fetch overview data", message: "Failed to fetch overview data" });
  }
});

// ==================== HOME PAGE API (Projects Report) ====================

router.get("/api/home/summary", requireAuth, async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, revenueSummaries, allTaskLinks, allOpTasks] = await Promise.all([
      storage.getAllProjectInfo(),
      getCanonicalAllCurrentCostLines(),
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

    const todayDate = new Date().toISOString().split("T")[0];
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
        pd.totalWeight += dur;
        if (plan.expectedPctComplete !== null && plan.expectedPctComplete !== undefined) {
          pd.weightedExpected += plan.expectedPctComplete * dur;
        } else {
          const tStart = plan.actualStart?.substring(0, 10);
          const tEnd = plan.actualEnd?.substring(0, 10);
          if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
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
            pd.weightedExpected += exp * dur;
          }
        }
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

    // CANONICAL Revenue Recognition (POC method) — applied unconditionally so
    // /api/home/summary matches /api/overview and the Revenue Tracker. The
    // legacy revenueSummaries table is no longer used as a revenue source
    // (it was milestone-derived during import); only currentVoTotal is kept
    // from it. Gross Profit follows the tracker convention:
    //    GP = POC-realised revenue − COS-realised cost
    // i.e. both sides use the same effective-realisation gate; we no longer
    // mix POC revenue with Paid-state cost.
    let actualRevenue = 0, realisedCost = 0, currentVoTotal = 0;
    const cmkHm = currentMonthKeyUtc();
    actualRevenue = sumRealisedRevenueRecognition(
      allExpenses as any,
      cmkHm,
      cosMonthKeyForLine,
    );
    const plannedRevenue = sumRevenueRecognition(allExpenses as any);
    let actualExpenses = 0; // Cash-paid concept (kept for cashflow tile)
    for (const expense of allExpenses) {
      const amt = safeNum(expense.expenseActualTotal);
      if (!amt) continue;
      const mk = cosMonthKeyForLine(expense);
      if (isEffectivelyRealised(expense as any, mk, cmkHm)) {
        realisedCost += amt;
      }
      const state = classifyExpenseState(expense as any);
      if (state === 'Paid') actualExpenses += amt;
    }
    for (const rs of revenueSummaries) {
      currentVoTotal += safeNum(rs.currentVoTotal);
    }
    const grossProfit = actualRevenue - realisedCost;
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
        plannedRevenue,
        revenueMethod: "POC",
        realisedCost,
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

router.get("/api/home/notes", requireAuth, async (req, res) => {
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

router.get("/api/projects-summary", requireAuth, async (req, res) => {
  try {
    const [allProjectInfo, allExpenses, rawInflows, allPlans, allEditableFields, allTaskLinks, allOpTasks, uploadMetaRows, smartImportRows, workItemsResult, handoverRows, phaseRows] = await Promise.all([
      storage.getAllProjectInfo().catch((e: any) => { console.warn("[dept-projects] allProjectInfo failed:", e.message); return []; }),
      getCanonicalAllCurrentCostLines().catch((e: any) => { console.warn("[dept-projects] allExpenses failed:", e.message); return []; }),
      storage.getAllProgramInflows().catch((e: any) => { console.warn("[dept-projects] rawInflows failed:", e.message); return []; }),
      storage.getAllProjectPlans().catch((e: any) => { console.warn("[dept-projects] rawPlans failed:", e.message); return []; }),
      storage.getAllProjectEditableFields().catch((e: any) => { console.warn("[dept-projects] allEditableFields failed:", e.message); return []; }),
      storage.getAllMilestoneTaskLinks().catch((e: any) => { console.warn("[dept-projects] allTaskLinks failed:", e.message); return []; }),
      storage.getAllOperationalTasks().catch((e: any) => { console.warn("[dept-projects] allOpTasks failed:", e.message); return []; }),
      db.execute(sql`SELECT DISTINCT file_name FROM upload_metadata`).catch((e: any) => { console.warn("[dept-projects] uploadMetadata failed:", e.message); return { rows: [] }; }),
      db.execute(sql`SELECT DISTINCT project_name FROM smart_import_runs WHERE status = 'committed'`).catch((e: any) => { console.warn("[dept-projects] smartImportRuns failed:", e.message); return { rows: [] }; }),
      // 2026-05-19: Broadened from PM-only to PM + ENG + QUALITY so the
      // /api/projects-summary "Progress Delta" column matches the Plan
      // tab and Excel project-plan rollup. Ordered by (project_id,
      // sort_order, source_row, id) to preserve workbook top-to-bottom
      // ordering — required by computeProjectProgress' indent-adjacency
      // parent detection. work_items has no native row_number column;
      // the downstream loop synthesizes one from this stable order. See
      // work-items-adapter.ts → getAllWorkItemsForProgress.
      db.execute(sql`SELECT wi.id, wi.project_id, pi.project_name, wi.percent_complete, wi.expected_pct_complete, wi.duration, wi.wbs_code, wi.start_date, wi.end_date, wi.actual_start, wi.actual_end, wi.title, wi.type, wi.is_milestone, wi.indent_level, wi.parent_id, wi.sort_order, wi.source_row, wi.workstream FROM work_items wi JOIN project_info pi ON wi.project_id = pi.id WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL ORDER BY wi.project_id ASC, wi.sort_order ASC NULLS LAST, wi.source_row ASC NULLS LAST, wi.id ASC`).catch((e: any) => { console.warn("[dept-projects] workItems failed:", e.message); return { rows: [] }; }),
      db.execute(sql`SELECT project_id, status, rejection_reason FROM project_pd_pm_handover`).catch(() => ({ rows: [] })),
      (getDbMode() === "sqlite"
        ? db.execute(sql`
            SELECT project_id, phase_name
            FROM (
              SELECT
                project_id,
                phase_name,
                ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC, id DESC) AS rn
              FROM normalized_execution_phases
            ) ranked_phases
            WHERE rn = 1
          `)
        : db.execute(sql`SELECT DISTINCT ON (project_id) project_id, phase_name FROM normalized_execution_phases ORDER BY project_id, created_at DESC`)
      ).catch((e: any) => { console.warn("[dept-projects] phaseRows failed:", e.message); return { rows: [] }; }),
    ]);

    // Build fallback phase lookup from normalized_execution_phases (populated by smart import)
    const phaseByProjectId = new Map<number, string>();
    for (const row of (phaseRows.rows || [])) {
      const r = row as any;
      if (r.project_id && r.phase_name) phaseByProjectId.set(r.project_id, r.phase_name);
    }

    const handoverMap = new Map<number, any>();
    for (const row of (handoverRows.rows || [])) {
      const r = row as any;
      handoverMap.set(r.project_id, r);
    }

    const workItemsByProject = new Map<string, any[]>();
    for (const row of workItemsResult.rows) {
      const r = row as any;
      const pName = r.project_name as string;
      if (!workItemsByProject.has(pName)) workItemsByProject.set(pName, []);
      workItemsByProject.get(pName)!.push(r);
    }
    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const milestoneKeys = new Set<string>();

    const importedProjectNames = new Set<string>();
    for (const row of uploadMetaRows.rows) {
      const fileName = (row as any).file_name as string;
      if (!fileName) continue;
      let stripped = fileName.replace(/\.(xlsx|xlsm|xls)$/i, '');
      stripped = stripped.replace(/^\d+_/, '');
      stripped = stripped.replace(/_Tracker$/i, '');
      importedProjectNames.add(stripped);
      importedProjectNames.add(stripped.replace(/ /g, '_'));
      importedProjectNames.add(stripped.replace(/_/g, ' '));
      importedProjectNames.add(stripped + '_Tracker');
      importedProjectNames.add(stripped.replace(/ /g, '_') + '_Tracker');
    }
    // Also include projects from smart import system
    for (const row of (smartImportRows as any).rows || []) {
      const pName = (row as any).project_name as string;
      if (!pName) continue;
      importedProjectNames.add(pName);
      importedProjectNames.add(pName.replace(/ /g, '_'));
      importedProjectNames.add(pName.replace(/_/g, ' '));
      importedProjectNames.add(pName + '_Tracker');
      importedProjectNames.add(pName.replace(/ /g, '_') + '_Tracker');
    }

    const today = new Date().toISOString().split("T")[0];

    const projectInfoNames = new Set<string>(allProjectInfo.map((info: any) => info.projectName).filter(Boolean));
    const resolveCanonicalProjectName = buildCanonicalResolver(projectInfoNames);

    const toCanonicalProjectName = (name: string | null | undefined): string => {
      if (!name) return "";
      return resolveCanonicalProjectName(name);
    };

    const expensesByProject = new Map<string, typeof allExpenses>();
    for (const expense of allExpenses) {
      const canonicalName = toCanonicalProjectName(expense.projectName);
      if (!canonicalName) continue;
      if (!expensesByProject.has(canonicalName)) expensesByProject.set(canonicalName, [] as any);
      (expensesByProject.get(canonicalName)! as any).push(expense);
    }

    const inflowsByProject = new Map<string, typeof allInflows>();
    for (const inflow of allInflows) {
      const canonicalName = toCanonicalProjectName(inflow.projectName);
      if (!canonicalName) continue;
      if (!inflowsByProject.has(canonicalName)) inflowsByProject.set(canonicalName, [] as any);
      (inflowsByProject.get(canonicalName)! as any).push(inflow);
    }

    const plansByProject = new Map<string, typeof allPlans>();
    for (const plan of allPlans) {
      const canonicalName = toCanonicalProjectName(plan.projectName);
      if (!canonicalName) continue;
      if (!plansByProject.has(canonicalName)) plansByProject.set(canonicalName, [] as any);
      (plansByProject.get(canonicalName)! as any).push(plan);
    }

    const editableMap = new Map(
      allEditableFields
        .map((f) => [toCanonicalProjectName(f.projectName), f] as const)
        .filter(([name]) => !!name),
    );

    const allProjectNames = new Set<string>();
    for (const info of allProjectInfo) {
      const name = toCanonicalProjectName(info.projectName);
      if (name) allProjectNames.add(name);
    }
    for (const expense of allExpenses) {
      const name = toCanonicalProjectName(expense.projectName);
      if (name) allProjectNames.add(name);
    }
    for (const inflow of allInflows) {
      const name = toCanonicalProjectName(inflow.projectName);
      if (name) allProjectNames.add(name);
    }
    for (const plan of allPlans) {
      const name = toCanonicalProjectName(plan.projectName);
      if (name) allProjectNames.add(name);
    }

    const taskCountsByProject = new Map<string, Record<string, number>>();
    for (const task of allOpTasks) {
      const rawName = toCanonicalProjectName(task.projectName);
      if (!rawName) continue;
      const trackerName = rawName.replace(/ /g, "_") + (rawName.endsWith("_Tracker") ? "" : "_Tracker");
      const key = allProjectNames.has(trackerName) ? trackerName : rawName;
      if (!taskCountsByProject.has(key)) taskCountsByProject.set(key, {});
      const counts = taskCountsByProject.get(key)!;
      const status = task.status || "TO DO";
      counts[status] = (counts[status] || 0) + 1;
    }

    const projectInfoMap = new Map<string, any>(allProjectInfo.map((info: any) => [info.projectName, info]));
    const projectInfoByCanonical = new Map<string, any>(
      allProjectInfo
        .map((info: any) => [toCanonicalProjectName(info.projectName), info] as const)
        .filter(([name]) => !!name),
    );

    // 2026-05-19: Precompute Plan-tab pill numbers for every project in
    // one batch so the per-project loop below can look them up by id and
    // produce the IDENTICAL Actual % / Expected % shown on the project
    // detail Plan tab. See server/services/plan-rollup-service.ts.
    const projectsSummaryPills = await computeAllProjectPlanPills({
      projectIds: allProjectInfo.map((p: any) => p.id).filter((id: any) => typeof id === 'number'),
      workstream: 'PM',
      todayIso: today,
    });
    // Name-keyed view of the same pill map so we can still resolve a pill
    // when the per-project loop fails to match `info.id` (e.g. a name in
    // `allProjectNames` that does not appear in `projectInfoMap`). This
    // preserves the pre-refactor behaviour where progress numbers were
    // computed from `projectWorkItems` regardless of `info` resolution.
    const projectsSummaryPillsByName = new Map<string, ReturnType<typeof projectsSummaryPills.get>>();
    for (const pill of projectsSummaryPills.values()) {
      if (pill?.projectName) projectsSummaryPillsByName.set(toCanonicalProjectName(pill.projectName), pill);
    }

    const projectsSummary = Array.from(allProjectNames).map(projectName => {
      const info = projectInfoMap.get(projectName) || projectInfoByCanonical.get(toCanonicalProjectName(projectName));
      const projectExpenses = expensesByProject.get(projectName) || [];
      const projectInflows = inflowsByProject.get(projectName) || [];
      const projectPlans = plansByProject.get(projectName) || [];
      const editable = editableMap.get(projectName);
      const handover = info?.id ? handoverMap.get(info.id) : null;

      const projectWorkItems =
        workItemsByProject.get(projectName) ||
        workItemsByProject.get(projectName.replace(/_/g, " ")) ||
        workItemsByProject.get(projectName.replace(/ /g, "_")) ||
        [];

      function findMaxEndDateWI(items: any[], patterns: string[]): string | null {
        let maxDate: string | null = null;
        for (const wi of items) {
          const desc = (wi.title || '').toLowerCase();
          const matches = patterns.some(p => desc.includes(p.toLowerCase()));
          if (matches && wi.end_date && /^\d{4}-\d{2}-\d{2}/.test(wi.end_date)) {
            const dateStr = wi.end_date.substring(0, 10);
            if (!maxDate || dateStr > maxDate) maxDate = dateStr;
          }
        }
        return maxDate;
      }
      function findMinStartDateWI(items: any[], patterns: string[]): string | null {
        let minDate: string | null = null;
        for (const wi of items) {
          const desc = (wi.title || '').toLowerCase();
          const matches = patterns.some(p => desc.includes(p.toLowerCase()));
          if (matches && wi.start_date && /^\d{4}-\d{2}-\d{2}/.test(wi.start_date)) {
            const dateStr = wi.start_date.substring(0, 10);
            if (!minDate || dateStr < minDate) minDate = dateStr;
          }
        }
        return minDate;
      }

      const pdFromPlan = (projectWorkItems.length > 0 ? findMaxEndDateWI(projectWorkItems, ['bd handover', 'project charter handover']) : null) || findMaxEndDate(projectPlans, ['bd handover', 'project charter handover']);
      const csFromPlan = (projectWorkItems.length > 0 ? findMinStartDateWI(projectWorkItems, ['site establishment']) : null) || findMinStartDate(projectPlans, ['site establishment']);
      const commFromPlan = (projectWorkItems.length > 0 ? findMaxEndDateWI(projectWorkItems, ['commissioning']) : null) || findMaxEndDate(projectPlans, ['commissioning']);
      const omFromPlan = (projectWorkItems.length > 0 ? findMaxEndDateWI(projectWorkItems, ['handover to matriarch']) : null) || findMaxEndDate(projectPlans, ['handover to matriarch']);
      const chFromPlan = (projectWorkItems.length > 0 ? findMaxEndDateWI(projectWorkItems, ['handover to client']) : null) || findMaxEndDate(projectPlans, ['handover to client']);

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

      // CANONICAL Revenue Recognition (POC method) per project.
      //   totalContractRevenue = sum(revenue_recognition_amount) on this
      //                          project's cost lines (POC base)
      //   actualRevenue        = sum(revenue_recognition_amount) gated on
      //                          effective COS realisation for the period.
      // Falls back to milestone billing total for projects with no costed
      // revenue captured yet, so newly-imported projects don't show R0.
      const cmkPlist = currentMonthKeyUtc();
      let totalContractRevenue = sumRevenueRecognition(projectExpenses as any);
      let actualRevenue = sumRealisedRevenueRecognition(
        projectExpenses as any,
        cmkPlist,
        cosMonthKeyForLine,
      );
      if (totalContractRevenue === 0) {
        for (const inflow of projectInflows) {
          if (inflow.milestoneAmount) {
            totalContractRevenue += parseFloat(inflow.milestoneAmount) || 0;
          }
        }
      }

      let totalExpenses = 0;
      let actualExpenses = 0;
      let cosRealisedTotal = 0;
      for (const expense of projectExpenses) {
        if (expense.expenseActualTotal) {
          const amt = parseFloat(expense.expenseActualTotal) || 0;
          totalExpenses += amt;
          const state = (expense as any).computedState || classifyExpenseState(expense as any);
          if (state === 'Paid') {
            actualExpenses += amt;
          }
          if (isCosRealised(expense as any)) {
            cosRealisedTotal += amt;
          }
        }
      }
      const cosRealisedPct = totalExpenses > 0 ? cosRealisedTotal / totalExpenses : null;

      const gpPercent = totalContractRevenue > 0 ? 1 - (totalExpenses / totalContractRevenue) : null;

      let projectPctComplete: number | null = null;
      let expectedPctComplete: number | null = null;

      // 2026-05-19: Single source of truth via the Plan-tab pill service.
      // The /api/projects-summary "Progress Delta" column now goes
      // through the SAME pipeline as the project detail Plan tab pill,
      // so every surface shows the same numbers and they match the
      // Excel project-plan top-row rollup. The pill map is precomputed
      // before this loop. See server/services/plan-rollup-service.ts.
      const todayDate = today;

      if (projectWorkItems.length > 0) {
        const pill = (info?.id ? projectsSummaryPills.get(info.id) : undefined)
          ?? projectsSummaryPillsByName.get(toCanonicalProjectName(projectName));
        if (pill && pill.leafCount > 0 && pill.actualPct != null && pill.expectedPct != null) {
          // Pill returns 0..100; downstream consumers expect 0..1.
          projectPctComplete = (pill.actualPct as number) / 100;
          expectedPctComplete = (pill.expectedPct as number) / 100;
        }
      } else if (projectWorkItems.length === 0) {
        // Legacy plan_tasks fallback (projects with no work_items rows yet).
        const SECTION_HEADERS = ['no.', 'no', '#'];
        const filteredPlans = projectPlans.filter(p => {
          const tn = (p.taskNo || '').toString().toLowerCase().trim();
          if (SECTION_HEADERS.includes(tn)) return false;
          if (p.rowNumber && milestoneKeys.has(`${projectName}::${p.rowNumber}`)) return false;
          return true;
        });
        const progress = computeProjectProgress(
          filteredPlans.map((p: any) => ({
            taskNo: p.taskNo ?? null,
            rowNumber: p.rowNumber ?? null,
            parentRowNumber: p.parentRowNumber ?? null,
            indentLevel: p.indentLevel ?? null,
            durationDays: p.durationDays ?? null,
            actualPctComplete: p.actualPctComplete ?? null,
            expectedPctComplete: p.expectedPctComplete ?? null,
            startDate: p.startDate ?? null,
            endDate: p.endDate ?? null,
            actualStartDate: p.actualStart ?? null,
            actualEndDate: p.actualEnd ?? null,
          })),
          todayDate,
        );
        projectPctComplete = progress.leafCount > 0 ? progress.actualPct / 100 : null;
        expectedPctComplete = progress.leafCount > 0 ? progress.expectedPct / 100 : null;
      }
      const deltaVsExpected = (projectPctComplete !== null && expectedPctComplete !== null)
        ? projectPctComplete - expectedPctComplete : null;

      let revenueOutstanding = 0;
      for (const inflow of projectInflows) {
        if (inflow.milestoneAmount) {
          const hasInvoice = inflow.invoiceRaisedDate && /^\d{4}-\d{2}-\d{2}/.test(inflow.invoiceRaisedDate);
          const isPaid = inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inflow.paymentReceivedDate);
          if (hasInvoice && !isPaid) {
            revenueOutstanding += parseFloat(inflow.milestoneAmount) || 0;
          }
        }
      }

      let expensesDue = 0;
      for (const expense of projectExpenses) {
        if (expense.expenseActualTotal) {
          const hasInvoiceDate = expense.expenseInvoicedDate && /^\d{4}-\d{2}-\d{2}/.test(expense.expenseInvoicedDate);
          const isPaid = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(expense.expensePaymentDate);
          if (hasInvoiceDate && !isPaid) {
            expensesDue += parseFloat(expense.expenseActualTotal) || 0;
          }
        }
      }

      return {
        project_info_id: info?.id || null,
        project_name: projectName,
        size_kwp: sizeKwp,
        pd: info?.pd || null,
        pm: info?.pm || null,
        // C5 (audit closeout): cost_proposal_signed and epc_contract_signed
        // legacy text columns were dropped. Read canonical signed state from
        // projectExecutionState.cpSigned / signedStatus instead.
        cost_proposal_type: editable?.costProposalType || null,
        cost_proposal_link: editable?.costProposalLink || null,
        cost_proposal_na_reason: editable?.costProposalNaReason || null,
        funding_signed: editable?.fundingSigned || null,
        funding_type: editable?.fundingType || null,
        funding_link: editable?.fundingLink || null,
        funding_na_reason: editable?.fundingNaReason || null,
        epc_contract_type: editable?.epcContractType || null,
        epc_contract_link: editable?.epcContractLink || null,
        epc_contract_na_reason: editable?.epcContractNaReason || null,
        financial_close_achieved: !!(
          (editable?.costProposalType === 'link' || editable?.costProposalType === 'na') &&
          (editable?.fundingType === 'link' || editable?.fundingType === 'na') &&
          (editable?.epcContractType === 'link' || editable?.epcContractType === 'na')
        ),
        phase: (() => {
          const explicit = info?.executionPhase || info?.phase || (info?.id ? phaseByProjectId.get(info.id) : null) || null;
          if (explicit) return explicit;
          // Derive phase from key project dates when no explicit phase is stored
          if (clientHandoverDate && clientHandoverDate <= today) return "Commercial Close Out";
          if (omHandoverDate && omHandoverDate <= today) return "Handover";
          if (commissioningDate && commissioningDate <= today) return "QA";
          if (constructionStartDate && constructionStartDate <= today) return "Construction";
          if (constructionStartDate && constructionStartDate > today) return "Planning";
          if (pdHandoverDate && pdHandoverDate <= today) return "Financial Close";
          return null;
        })(),
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
        total_contract_revenue: totalContractRevenue,
        actual_revenue: actualRevenue,
        total_expenses: totalExpenses,
        actual_expenses: actualExpenses,
        gp_percent: gpPercent,
        cos_realised_pct: cosRealisedPct,
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
        is_active: info != null && (info.archivedStatus ?? 'ACTIVE') === 'ACTIVE' && info.phase?.toLowerCase() !== "gone",
        rag_status: info?.ragStatus ?? null,
        pd_pm_handover_status: handover?.status || "DRAFT",
        pd_pm_handover_rejection_reason: handover?.rejection_reason || null,
        next_open_inflow_milestone: (() => {
          const displayName = projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
          const pInflows = inflowsByProject.get(projectName) || inflowsByProject.get(displayName) || [];
          const open = pInflows
            .filter((inf: any) => (!inf.paymentReceivedDate || String(inf.paymentReceivedDate).trim() === '') && inf.milestoneName)
            .sort((a: any, b: any) => (a.rowNumber || 0) - (b.rowNumber || 0));
          if (open.length === 0) return null;
          const next = open[0];
          const plannedDate = next.effectiveDate || next.computedForecastReceiptDate || next.plannedPaymentDate || null;
          const isOverdue = plannedDate && /^\d{4}-\d{2}-\d{2}/.test(plannedDate) && plannedDate < today;
          return { name: next.milestoneName, plannedDate, overdue: !!isOverdue, openCount: open.length };
        })(),
      };
    });

    res.json(projectsSummary);
  } catch (error) {
    console.error("Projects summary fetch error:", error);
    throw error;
  }
});

router.post("/api/projects-summary/:projectName/edit", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const editSchema = z.object({
      // C5 (audit closeout): costProposalSigned and epcContractSigned removed.
      // Use projectExecutionState.cpSigned / signedStatus to mutate signed state.
      fundingSigned: z.string().nullable().optional(),
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

router.patch("/api/projects-summary/:projectName/latest-update", requireAuth, requirePermission('projects', 'edit'), async (req, res) => {
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
    const id = parseIntParam(req.params.projectInfoId);
    const schema = z.object({
      escalationLevel: z.enum(["None", "Low", "Medium", "High", "Highest"]).nullable(),
    });
    const { escalationLevel } = schema.parse(req.body);
    const result = await storage.updateProjectInfoById(id, { escalationLevel });
    const pName = result?.projectName || "Unknown";
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
      getCanonicalAllCurrentCostLines(),
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

      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      if (!cosDate) continue;
      const dateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      cosTotalByMonth.set(monthKey, (cosTotalByMonth.get(monthKey) || 0) + amount);

      // Past-month committed costs are effectively realised
      const nowD = new Date();
      const curMK = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
      const cosStatus = classifyCosStatusFull(exp as any);
      const effectivelyRealised = (cosStatus === 'COS Realised' && monthKey <= curMK) ||
                                   (cosStatus === 'Committed' && monthKey < curMK);
      if (effectivelyRealised) {
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

    const projectInfoMap = new Map<string, any>(allProjectInfo.map((info: any) => [info.projectName, info]));

    const activeProjectInfo = allProjectInfo.filter(info =>
      info.isActive !== false &&
      info.archivedStatus !== 'ARCHIVED' &&
      info.phase?.toLowerCase() !== 'gone'
    );
    const activeProjectNames = new Set(activeProjectInfo.map(info => info.projectName));

    const allProjectNames = new Set<string>();
    for (const info of activeProjectInfo) allProjectNames.add(info.projectName);
    for (const expense of allExpenses) {
      if (activeProjectNames.has(expense.projectName)) allProjectNames.add(expense.projectName);
    }
    for (const inflow of allInflows) {
      if (activeProjectNames.has(inflow.projectName)) allProjectNames.add(inflow.projectName);
    }
    for (const plan of allPlans) {
      if (activeProjectNames.has(plan.projectName)) allProjectNames.add(plan.projectName);
    }

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
          const amt = parseFloat(inflow.milestoneAmount) || 0;
          const dateToCheck = inflow.effectiveDate || inflow.invoiceRaisedDate;
          const arState = evaluateRevenueArStatus({
            status: inflow.lineStatus || inflow.status || inflow.computedState || null,
            manualInBank: inflow.inBank,
            paymentReceivedDate: inflow.paymentReceivedDate,
            dueDate: dateToCheck,
            invoiceNumber: inflow.milestoneInvoiceNumber,
            amount: amt,
            today,
          });
          if (arState.isOverdue) {
            revenueOutstanding += amt;
            projRevOutstanding += amt;
          }
        }
        if (isThisWeek(inflow.effectiveDate) && inflow.milestoneAmount) {
          inflowsThisWeek += parseFloat(inflow.milestoneAmount) || 0;
        }
      }
      if (projRevOutstanding > 0) {
        revenueOutstandingProjects.push({ projectName, amount: projRevOutstanding, milestone: null });
      }

      let projInflowsWeek = 0;
      let projOutflowsWeek = 0;
      for (const inflow of projectInflows) {
        if (isThisWeek(inflow.effectiveDate) && inflow.milestoneAmount) {
          projInflowsWeek += parseFloat(inflow.milestoneAmount) || 0;
        }
      }
      if (projInflowsWeek > 0) {
        inflowProjects.push({ projectName, amount: projInflowsWeek });
      }

      let projExpOverdue = 0;
      let projHasInvoice = false;
      for (const expense of projectExpenses) {
        if (expense.expenseActualTotal) {
          const amt = parseFloat(expense.expenseActualTotal) || 0;
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
          projOutflowsWeek += parseFloat(expense.expenseActualTotal) || 0;
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
      if (pm && pm.trim()) {
        if (!pmStats.has(pm)) pmStats.set(pm, { activeProjects: 0, commissioningThisMonth: 0, clientHandoverThisMonth: 0 });
        const stats = pmStats.get(pm)!;
        stats.activeProjects++;
        if (isThisMonth(commissioningDate)) {
          stats.commissioningThisMonth++;
        }
        if (isThisMonth(clientHandoverDate)) {
          stats.clientHandoverThisMonth++;
        }
      }
    }

    const pmTable = Array.from(pmStats.entries())
      .map(([pm, stats]) => ({ pm, ...stats }))
      .filter(row => row.activeProjects > 0 || row.commissioningThisMonth > 0 || row.clientHandoverThisMonth > 0);

    const phaseCountMap = new Map<string, number>();
    const phaseCanonicalMap = new Map<string, string>();
    for (const info of activeProjectInfo) {
      const rawPhase = info.phase && info.phase.trim() !== '' ? info.phase.trim() : '(blank)';
      const key = rawPhase.toLowerCase();
      if (!phaseCanonicalMap.has(key)) phaseCanonicalMap.set(key, rawPhase);
      const canonical = phaseCanonicalMap.get(key)!;
      phaseCountMap.set(canonical, (phaseCountMap.get(canonical) || 0) + 1);
    }
    const PHASE_LIFECYCLE_ORDER = [
      "DLP", "Financial Close", "Planning", "Construction", "QA",
      "Handover", "Commercial Close Out", "3 Months Post HO Review",
      "Compliance Handover", "Hold", "Done"
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
      if (!activeProjectNames.has(projectName)) continue;
      if (hasPhaseData && !constructionQAPhases.has(projectName)) continue;
      const validPlans = plans.filter((p: any) => {
        const act = p.actualPctComplete ?? p.percentComplete;
        return act != null;
      });
      if (validPlans.length === 0) continue;
      let totalWeight = 0, weightedActual = 0, weightedExpected = 0;
      const todayStr = today;
      for (const p of validPlans as any[]) {
        const dur = (p.durationDays && p.durationDays > 0) ? p.durationDays : 1;
        const act = p.actualPctComplete ?? p.percentComplete ?? 0;
        weightedActual += (parseFloat(act) || 0) * dur;
        let exp = p.expectedPctComplete ?? p.expectedProgress ?? null;
        if (exp == null) {
          const tStart = p.actualStart?.substring(0, 10);
          const tEnd = p.actualEnd?.substring(0, 10);
          if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
            if (todayStr >= tEnd) exp = 1.0;
            else if (todayStr <= tStart) exp = 0.0;
            else {
              const totalDays = Math.max(1, (new Date(tEnd).getTime() - new Date(tStart).getTime()) / 86400000);
              const elapsedDays = (new Date(todayStr).getTime() - new Date(tStart).getTime()) / 86400000;
              exp = Math.min(elapsedDays / totalDays, 1.0);
            }
          } else {
            exp = 0;
          }
        }
        weightedExpected += (parseFloat(exp) || 0) * dur;
        totalWeight += dur;
      }
      if (totalWeight > 0) {
        const rawActual = weightedActual / totalWeight;
        const rawExpected = weightedExpected / totalWeight;
        completionCompare.push({
          projectName,
          actualPct: rawActual <= 1.0 ? rawActual * 100 : rawActual,
          expectedPct: rawExpected <= 1.0 ? rawExpected * 100 : rawExpected,
        });
      }
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
      getCanonicalAllCurrentCostLines(),
      storage.getAllProgramInflows(),
      storage.getAllProjectPlans(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
    ]);

    const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

    const today = new Date().toISOString().split("T")[0];
    const projectInfoMap = new Map<string, any>(allProjectInfo.map((info: any) => [info.projectName, info]));

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
        const amt = parseFloat(expense.expenseActualTotal) || 0;
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
        const amt = parseFloat(inflow.milestoneAmount) || 0;
        const dateToCheck = inflow.effectiveDate || inflow.invoiceRaisedDate;
        const arState = evaluateRevenueArStatus({
          status: inflow.lineStatus || inflow.status || inflow.computedState || null,
          manualInBank: inflow.inBank,
          paymentReceivedDate: inflow.paymentReceivedDate,
          dueDate: dateToCheck,
          invoiceNumber: inflow.milestoneInvoiceNumber,
          amount: amt,
          today,
        });
        if (arState.isOverdue) {
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

router.get("/api/dashboard", requireAuth, async (req, res) => {
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

router.get("/api/projects", requireAuth, async (req, res) => {
  try {
    const projects = await storage.getAllProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch projects", message: "Failed to fetch projects" });
  }
});

router.get("/api/projects/:id", requireAuth, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    const project = await storage.getProject(id);
    if (!project) {
      return res.status(404).json({ error: "Project not found", message: "Project not found" });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project", message: "Failed to fetch project" });
  }
});

router.get("/api/projects/:id/header-kpis", requireAuth, async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return res.status(400).json({ error: "Invalid project id" });
    }
    const kpis = await getProjectHeaderKpis(projectId);
    return res.json(kpis);
  } catch (error: any) {
    console.error("[project-routes] header-kpis error:", error);
    return res.status(500).json({ error: "Failed to load header KPIs" });
  }
});

router.post("/api/projects/header-kpis/recompute", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await recomputeHeaderKpiProjectionForActiveProjects();
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[project-routes] header-kpis recompute error:", error);
    return res.status(500).json({ error: "Failed to recompute KPI projection" });
  }
});

// ==================== PROJECT PLANS ====================

router.get("/api/project-plans", requireAuth, async (req, res) => {
  try {
    const { projectName, applyOverrides } = req.query;
    let plans;
    
    if (projectName && typeof projectName === 'string') {
      plans = await storage.getProjectPlansByProject(projectName);
      
      return res.json(plans);
    }
    plans = await storage.getAllProjectPlans();
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project plans", message: "Failed to fetch project plans" });
  }
});

router.get("/api/project-plan/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = req.params.projectName as string;
    const { applyOverrides } = req.query;

    let plans = await storage.getProjectPlansByProject(projectName);

    // Override data is now baked into base rows (override collapse)
    
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project plan", message: "Failed to fetch project plan", code: "PROJECT_PLAN_ERROR" });
  }
});

// ==================== PROJECT INFO ====================

router.get("/api/project-info", requireAuth, async (req, res) => {
  try {
    const info = await storage.getAllProjectInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project info", message: "Failed to fetch project info" });
  }
});

router.get("/api/pm-assignable-users", requireAuth, async (_req, res) => {
  try {
    const pmUsers = await usersRepository.listAssignableByRole("PROJECT_MANAGER_SITE");
    res.json(pmUsers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/api/pd-assignable-users", requireAuth, async (_req, res) => {
  try {
    const pdUsers = await usersRepository.listAssignableByRole("PROJECT_DEVELOPER");
    res.json(pdUsers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/api/project-info/:id/assign-pm", requireAuth, requirePermission('projects', 'edit'), async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

    const schema = z.object({
      pm: z.string().min(1),
      pmUserId: z.number().nullable().optional(),
    });
    const { pm, pmUserId } = schema.parse(req.body);

    const updated = await storage.updateProjectInfoById(id, { pm } as any);
    if (!updated) return res.status(404).json({ error: "Project not found" });

    if (pmUserId) {
      await projectInfoRepository.updateById(id, { pmUserId });
    }

    const pName = updated?.projectName || "Unknown";
    res.json(updated);
  } catch (error) {
    console.error("PM assignment error:", error);
    res.status(500).json({ error: "Failed to assign PM" });
  }
});

router.patch("/api/project-info/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
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
      clientId: z.number().nullable().optional(),
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


// ==================== KEY DATE MAPPINGS ====================

router.get("/api/key-date-mappings/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mappings = await storage.getKeyDateMappings(decodeURIComponent(req.params.projectName as string));
    res.json(mappings);
  } catch (err: unknown) {
    throw err;
  }
});

router.post("/api/key-date-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mapping = await storage.createKeyDateMapping({ ...req.body, createdBy: (req.user as any)?.id });
    res.json(mapping);
  } catch (err: unknown) {
    throw err;
  }
});

router.patch("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateKeyDateMapping(parseIntParam(req.params.id), req.body);
    res.json(updated);
  } catch (err: unknown) {
    throw err;
  }
});

router.delete("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await storage.deleteKeyDateMapping(parseIntParam(req.params.id));
    res.json({ success: true });
  } catch (err: unknown) {
    throw err;
  }
});

router.get("/api/key-dates/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
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
  } catch (err: unknown) {
    throw err;
  }
});

export function registerProjectRoutes(app: Express) {
  app.use(router);
}
