// TODO: remove @ts-nocheck
// @ts-nocheck
import type { Express, Request, Response, NextFunction } from "express";
import { toCanonicalEngineeringStageStatus } from "@shared/status-logic";
import { computeMarginPct } from "../lib/finance/margin";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, or, sql, isNull, asc, desc, inArray } from "drizzle-orm";
import { projectInfo, normalizedCostLines, normalizedRevenueLines, normalizedExecutionPhases, smartImportRuns, users, workItems, cashflowPoints, financeRevenueMonthly, financeCosMonthly } from "@shared/schema";
import { logAuditFromReq } from "../audit-logger";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { getAllPMWorkItemsAsProjectPlan } from "../work-items-adapter";
import { classifyCosStatus } from "../lib/calculations/stateClassifier";
import { evaluateRevenueArStatus } from "../lib/finance/revenue-ar-status";

async function getMergedExpensesAndInflows(expenses: any[], inflows: any[]) {
  return { expenses, inflows };
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
  for (const t of operationalTasks) opTaskMap.set(t.id, t);
  const planTaskMap = new Map<number, any>();
  for (const t of planTasks) planTaskMap.set(t.id, t);

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
    return { ...inf, effectiveDate: inf.computedForecastReceiptDate || inf.plannedPaymentDate || null };
  });
}

// SA working days helpers
function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const s = dateStr.substring(0, 10);
  return { year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)), day: parseInt(s.substring(8, 10)) };
}
function computeEaster(year: number): { year: number; month: number; day: number } {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}
function getSAPublicHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(formatDateKey(year, m, d));
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() === 0) {
      const next = new Date(dt); next.setUTCDate(next.getUTCDate() + 1);
      holidays.add(formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()));
    }
  };
  add(1, 1); add(3, 21); add(4, 27); add(5, 1); add(6, 16);
  add(8, 9); add(9, 24); add(12, 16); add(12, 25); add(12, 26);
  const easter = computeEaster(year);
  const gf = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  gf.setUTCDate(gf.getUTCDate() - 2);
  holidays.add(formatDateKey(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate()));
  const fd = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  fd.setUTCDate(fd.getUTCDate() + 1);
  holidays.add(formatDateKey(fd.getUTCFullYear(), fd.getUTCMonth() + 1, fd.getUTCDate()));
  return holidays;
}
const holidayCacheByYear = new Map<number, Set<string>>();
function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4));
  if (!holidayCacheByYear.has(year)) holidayCacheByYear.set(year, getSAPublicHolidays(year));
  return holidayCacheByYear.get(year)!.has(dateStr);
}
function saWorkingDays(startDateStr: string | null, endDateStr: string | null): number | null {
  if (!startDateStr || !endDateStr || !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)) return null;
  const s = parseDateParts(startDateStr); const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0; const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function registerDashboardRoutes(app: Express) {
  // ==================== PROGRAM DASHBOARD API ====================

  app.get("/api/program-dashboard", requireAuth, async (req, res) => {
    try {
      const now = new Date();
      const fyStartYear = (now.getMonth() + 1) >= 9 ? now.getFullYear() : now.getFullYear() - 1;
      const fyStart = `${fyStartYear}-09-01`;
      const fyEnd = `${fyStartYear + 1}-08-31`;
      const today = now.toISOString().slice(0, 10);

      const [allProjectInfo, revenueRows, costRows, importRuns, engRows, approvalsRows, canonicalPlanTasks, qualityResult, usersResult, cashflowPointRows, financeRevenueRows, financeCosRows, revOverrides, cosOverrides] = await Promise.all([
        storage.getAllProjectInfo(),
        db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
        db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
        db.select().from(smartImportRuns).where(eq(smartImportRuns.status, 'COMMITTED')),
        // Read ENG work_items
        db.select().from(workItems).where(and(eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt))),
        db.execute(sql`SELECT id, project_id, status, title, due_date, assigned_approver FROM approvals`).catch(() => ({ rows: [] })),
        getAllPMWorkItemsAsProjectPlan(),
        db.execute(sql`SELECT id, project_name, severity, status, title, owner_user_id, due_date FROM qc_warning`).catch(() => ({ rows: [] })),
        db.execute(sql`SELECT id, name FROM users`),
        db.select().from(cashflowPoints).where(isNull(cashflowPoints.effectiveTo)),
        db.select().from(financeRevenueMonthly).where(isNull(financeRevenueMonthly.effectiveTo)),
        db.select().from(financeCosMonthly).where(isNull(financeCosMonthly.effectiveTo)),
        Promise.resolve([]),
        Promise.resolve([]),
      ]);

      const userNameById = new Map<number, string>((usersResult.rows as any[]).map((u: any) => [Number(u.id), u.name || `User ${u.id}`]));
      const hasText = (v: any) => typeof v === 'string' && v.trim().length > 0;
      const toNum = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
      const isBlack = (v: any) => { const s = String(v || '').toLowerCase(); return s.includes('000000') || s.includes('black'); };
      const isInFy = (d: string | null | undefined) => !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && d >= fyStart && d <= fyEnd);
      const taskIntersectsFy = (t: any) => {
        const s = t.actual_start_date || t.start_date;
        const e = t.actual_end_date || t.end_date || s;
        if (!s && !e) return false;
        const start = (s || e || '').slice(0, 10);
        const end = (e || s || '').slice(0, 10);
        return !!start && !!end && start <= fyEnd && end >= fyStart;
      };

      // Build override lookup sets so dashboard aggregates respect manual overrides
      const inBankOverrideSet = new Set(
        revOverrides.filter((o: any) => o.overrideValue === "1").map((o: any) => `${o.projectName}::${o.rowNumber}`)
      );
      const cosOverrideByKey = new Map<string, string>();
      for (const co of cosOverrides) {
        cosOverrideByKey.set(`${co.projectName}::${co.rowNumber}`, co.overrideStatus);
      }

      // RLS: scope project data to user's accessible projects
      const { resolveProjectScope } = await import("./services/project-access-service");
      const dashUser = (req as any).user;
      const dashScope = await resolveProjectScope(
        dashUser?.id || 0,
        dashUser?.role || "",
        dashUser?.name || "",
      );
      const scopedProjectInfo = dashScope.kind === "full_oversight"
        ? allProjectInfo
        : allProjectInfo.filter((p: any) => dashScope.projectIds.has(p.id));

      const projectById = new Map<number, any>();
      const projectByName = new Map<string, any>();
      for (const p of scopedProjectInfo) {
        if (p.id) projectById.set(p.id, p);
        projectByName.set((p.projectName || '').toLowerCase(), p);
      }

      const planRows = canonicalPlanTasks as any[];
      const qualityRows = qualityResult.rows as any[];
      const approvalRows = approvalsRows.rows as any[];

      const rowsByProject = new Map<number, any>();
      const ensureRow = (proj: any) => {
        if (!rowsByProject.has(proj.id)) rowsByProject.set(proj.id, {
          projectId: proj.id, projectName: proj.projectName, portfolio: proj.portfolio || null, pm: proj.pm || null, pd: proj.pd || null,
          executionPhase: proj.executionPhase || proj.phase || null, rag: proj.ragStatus || 'UNKNOWN',
          ragUpdatedAt: proj.ragUpdatedAt || null,
          actualProgressPct: 0, expectedProgressPct: 0, scheduleVariancePct: 0,
          plannedRevenueFy: 0, receivedInflowFy: 0, openInflowFy: 0,
          plannedExpenditureFy: 0, paidExpenditureFy: 0, openExpenditureFy: 0, grossMarginPctFy: null,
          engineeringStatus: 'On Track', qualityStatus: 'On Track', importFreshness: 'Critical', importAgeDays: null,
          criticalActionCount: 0,
          _taskWeight: 0, _taskActual: 0, _taskExpected: 0, _expCount: 0,
          _engOpen: 0, _qualityOpen: 0, _approvalsPending: 0,
          _inflowRisk: 0, _outflowRisk: 0,
        });
        return rowsByProject.get(proj.id);
      };

      const committedProjectIds = new Set<number>();
      const committedProjectNames = new Set<string>();
      const latestImportByProject = new Map<number, string>();
      for (const r of importRuns) {
        if (r.projectId) committedProjectIds.add(r.projectId);
        committedProjectNames.add((r.projectName || '').toLowerCase());
        const proj = r.projectId ? projectById.get(r.projectId) : projectByName.get((r.projectName || '').toLowerCase());
        if (!proj) continue;
        const stamp = ((r.committedAt as any) || (r.uploadedAt as any) || null);
        if (!stamp) continue;
        const s = new Date(stamp).toISOString();
        const prev = latestImportByProject.get(proj.id);
        if (!prev || s > prev) latestImportByProject.set(proj.id, s);
      }

      // Group plan tasks by project for leaf-task identification
      const planTasksByProjectId = new Map<number, any[]>();
      for (const t of planRows) {
        const proj = t.projectId ? projectById.get(Number(t.projectId)) : projectByName.get(String(t.projectName || '').toLowerCase());
        if (!proj) continue;
        const row = ensureRow(proj);
        const wiStart = (t.actualStart || t.startDate || '').slice(0,10);
        const wiEnd = (t.actualEnd || t.endDate || '').slice(0,10);
        if (wiStart && wiEnd && wiStart <= fyEnd && wiEnd >= fyStart) row.__hasFyItem = true;
        if (!planTasksByProjectId.has(proj.id)) planTasksByProjectId.set(proj.id, []);
        planTasksByProjectId.get(proj.id)!.push(t);
      }

      // Compute leaf-task simple-average progress per project (matching UnifiedPlanTab)
      const todayMs = new Date(today).getTime();
      for (const [projId, tasks] of planTasksByProjectId) {
        const row = rowsByProject.get(projId);
        if (!row) continue;

        // Filter out section headers / summary rows
        const SECTION_HEADERS = ['no.', 'no', '#'];
        const filtered = tasks.filter((t: any) => {
          const tn = (t.taskNo || '').toString().toLowerCase().trim();
          return !SECTION_HEADERS.includes(tn);
        });

        // Identify parent rows via parentRowNumber and indent level
        const parentRows = new Set<number>();
        for (const t of filtered) {
          if (t.parentRowNumber) parentRows.add(t.parentRowNumber);
        }
        for (let i = 0; i < filtered.length - 1; i++) {
          const currIndent = filtered[i].indentLevel ?? 0;
          const nextIndent = filtered[i + 1].indentLevel ?? 0;
          if (nextIndent > currIndent && filtered[i].rowNumber) {
            parentRows.add(filtered[i].rowNumber);
          }
        }
        const leafTasks = filtered.filter((t: any) => !t.rowNumber || !parentRows.has(t.rowNumber));
        const items = leafTasks.length > 0 ? leafTasks : filtered;

        let actualSum = 0;
        let expSum = 0;
        let expCount = 0;
        for (const t of items) {
          actualSum += toNum(t.actualPctComplete) * 100;
          if (t.expectedPctComplete != null) {
            expSum += toNum(t.expectedPctComplete) * 100;
            expCount++;
          } else {
            const s = (t.actualStart || t.startDate || '').slice(0,10);
            const e = (t.actualEnd || t.endDate || '').slice(0,10);
            if (s && e && /^\d{4}-\d{2}-\d{2}/.test(s) && /^\d{4}-\d{2}-\d{2}/.test(e)) {
              const sMs = new Date(s).getTime();
              const eMs = new Date(e).getTime();
              let exp: number;
              if (todayMs >= eMs) exp = 100;
              else if (todayMs <= sMs) exp = 0;
              else { const total = Math.max(1, (eMs - sMs) / 86400000); exp = Math.min(((todayMs - sMs) / 86400000) / total, 1.0) * 100; }
              expSum += exp;
              expCount++;
            }
          }
        }
        // Store as simple counts for final averaging
        row._taskActual = actualSum;
        row._taskExpected = expSum;
        row._taskWeight = items.length;
        row._expCount = expCount;
      }

      for (const r of revenueRows) {
        const proj = r.projectId ? projectById.get(r.projectId) : projectByName.get((r.projectName || '').toLowerCase());
        if (!proj) continue;
        const dateKey = (r.expectedPaymentDate || r.invoiceDate || r.paidDate || '').slice(0,10);
        if (!isInFy(dateKey)) continue;
        const row = ensureRow(proj); row.__hasFyItem = true;
        const amt = toNum(r.amountExVat);
        row.plannedRevenueFy += amt;
        const baseReceived = hasText(r.invoiceNumber) && hasText(r.paidDate) && isBlack(r.paidDateFontColor);
        const overrideInBank = inBankOverrideSet.has(`${r.projectName}::${r.sourceRow}`);
        const received = baseReceived || overrideInBank;
        if (received) row.receivedInflowFy += amt;
        if (!received && dateKey && dateKey < today) row._inflowRisk += amt;
      }

      const currentMonthKey = today.slice(0, 7);
      let cosPlannedMonth = 0;
      let cosRealisedMonth = 0;

      for (const c of costRows) {
        const proj = c.projectId ? projectById.get(c.projectId) : projectByName.get((c.projectName || '').toLowerCase());
        if (!proj) continue;
        const dateKey = (c.approvedDate || c.invoiceDate || c.paidDate || '').slice(0,10);
        if (!isInFy(dateKey)) continue;
        const row = ensureRow(proj); row.__hasFyItem = true;
        const amt = toNum(c.amountExVat);
        row.plannedExpenditureFy += amt;
        const paid = hasText(c.invoiceNumber) && hasText(c.paidDate) && isBlack(c.paidDateFontColor);
        if (paid) row.paidExpenditureFy += amt;
        if (!paid && dateKey && dateKey < today) row._outflowRisk += amt;

        if (dateKey && dateKey.slice(0, 7) === currentMonthKey) {
          cosPlannedMonth += amt;
          const cosOverrideStatus = cosOverrideByKey.get(`${c.projectName}::${c.sourceRow}`);
          const isRealised = cosOverrideStatus === 'COS Realised' || (!cosOverrideStatus && classifyCosStatus({
            expenseInvoiceNumber: c.invoiceNumber,
            expenseInvoicedDate: c.invoiceDate,
            expensePoNumber: c.poNumber,
            invoiceDateConfirmed: c.invoiceDateConfirmed,
            invoiceDateFontColor: c.invoiceDateFontColor,
          }) === 'COS Realised');
          if (isRealised) cosRealisedMonth += amt;
        }
      }

      for (const e of engRows) {
        const proj = e.projectId ? projectById.get(e.projectId) : projectByName.get((e.projectName || '').toLowerCase());
        if (!proj) continue;
        const row = ensureRow(proj);
        if (toCanonicalEngineeringStageStatus(e.status) !== 'complete' && !e.softDeletedAt) row._engOpen += 1;
      }

      for (const q of qualityRows) {
        const proj = q.project_name ? projectByName.get(String(q.project_name).toLowerCase()) : null;
        if (!proj) continue;
        const row = ensureRow(proj);
        if (String(q.status || '').toLowerCase() === 'open') row._qualityOpen += 1;
      }

      for (const a of approvalRows) {
        const proj = a.project_id ? projectById.get(Number(a.project_id)) : null;
        if (!proj) continue;
        const row = ensureRow(proj);
        if (String(a.status || '').toLowerCase() === 'pending') row._approvalsPending += 1;
      }

      let projects = Array.from(rowsByProject.values()).filter((row: any) => {
        const info = projectById.get(row.projectId);
        if (!info) return false;
        const isActive = info.archivedStatus === 'ACTIVE' && info.isActive !== false;
        const hasImport = committedProjectIds.has(row.projectId) || committedProjectNames.has((row.projectName || '').toLowerCase());
        return isActive && hasImport && !!row.__hasFyItem;
      });

      projects.forEach((row: any) => {
        row.actualProgressPct = row._taskWeight > 0 ? row._taskActual / row._taskWeight : 0;
        row.expectedProgressPct = (row._expCount || row._taskWeight) > 0 ? row._taskExpected / (row._expCount || row._taskWeight) : 0;
        row.scheduleVariancePct = row.actualProgressPct - row.expectedProgressPct;
        // Compute RAG from progress delta when manual ragStatus is absent (matching projects-summary)
        if (row.rag === 'UNKNOWN') {
          const delta = row.scheduleVariancePct;
          row.rag = delta >= -5 ? 'Green' : delta >= -15 ? 'Amber' : 'Red';
        }
        row.openInflowFy = row.plannedRevenueFy - row.receivedInflowFy;
        row.openExpenditureFy = row.plannedExpenditureFy - row.paidExpenditureFy;
        row.grossMarginPctFy = computeMarginPct(row.plannedRevenueFy, row.plannedExpenditureFy, { precision: 1 });
        row.engineeringStatus = row._engOpen >= 5 ? 'Blocked' : row._engOpen > 0 ? 'At Risk' : 'On Track';
        row.qualityStatus = row._qualityOpen >= 5 ? 'Blocked' : row._qualityOpen > 0 ? 'At Risk' : 'On Track';
        const latest = latestImportByProject.get(row.projectId);
        if (latest) {
          const age = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
          row.importAgeDays = age;
          row.importFreshness = age >= 14 ? 'Critical' : age >= 7 ? 'Warning' : 'Fresh';
        }
        const behind = row.actualProgressPct < row.expectedProgressPct - 5 ? 1 : 0;
        row.criticalActionCount = behind + (row._inflowRisk > 0 ? 1 : 0) + (row._outflowRisk > 0 ? 1 : 0) + (row._engOpen > 0 ? 1 : 0) + (row._qualityOpen > 0 ? 1 : 0) + (row._approvalsPending > 0 ? 1 : 0);
      });

      const q = req.query as Record<string, string | undefined>;
      const toggle = (name: string) => (q[name] || '').toLowerCase() === 'true';
      const includes = (a: any, v: string | undefined) => !v || String(a || '').toLowerCase() === v.toLowerCase();
      projects = projects.filter((p: any) => {
        if (q.search && !String(p.projectName || '').toLowerCase().includes(q.search.toLowerCase())) return false;
        if (!includes(p.portfolio, q.portfolio)) return false;
        if (!includes(p.pm, q.pm)) return false;
        if (!includes(p.pd, q.pd)) return false;
        if (!includes(p.executionPhase, q.executionPhase)) return false;
        if (!includes(p.rag, q.rag)) return false;
        if (toggle('exceptionOnly') && p.criticalActionCount === 0) return false;
        if (toggle('behindPlanOnly') && !(p.actualProgressPct < p.expectedProgressPct - 5)) return false;
        if (toggle('inflowRiskOnly') && !(p._inflowRisk > 0)) return false;
        if (toggle('outflowRiskOnly') && !(p._outflowRisk > 0)) return false;
        if (toggle('engineeringBlockersOnly') && !(p._engOpen > 0)) return false;
        if (toggle('qualityIssuesOnly') && !(p._qualityOpen > 0)) return false;
        if (toggle('pendingApprovalsOnly') && !(p._approvalsPending > 0)) return false;
        if (toggle('staleImportsOnly') && p.importFreshness === 'Fresh') return false;
        return true;
      });

      const visibleProjectNames = new Set(projects.map((p: any) => String(p.projectName || '').toLowerCase()));
      const visibleProjectIds = new Set(projects.map((p: any) => Number(p.projectId)).filter((id: number) => Number.isFinite(id)));
      const visibleProjectInfo = scopedProjectInfo.filter((info: any) => visibleProjectIds.has(Number(info.id)));
      const monthLabel = (monthKey: string) => {
        try {
          return format(new Date(`${monthKey}-01T00:00:00`), "MMM yyyy");
        } catch {
          return monthKey;
        }
      };
      const weekLabel = (dateKey: string) => {
        try {
          return format(new Date(`${dateKey}T00:00:00`), "dd MMM");
        } catch {
          return dateKey;
        }
      };
      const toDateKey = (value: any) => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
      };
      const toMonthKey = (value: any) => {
        const dateKey = toDateKey(value);
        return dateKey ? dateKey.slice(0, 7) : null;
      };
      const toWeekStartKey = (value: any) => {
        const dateKey = toDateKey(value);
        if (!dateKey) return null;
        const date = new Date(`${dateKey}T00:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        const day = date.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        date.setDate(date.getDate() + diff);
        return date.toISOString().slice(0, 10);
      };
      const ensureBucket = (map: Map<string, any>, key: string, factory: () => any) => {
        if (!map.has(key)) map.set(key, factory());
        return map.get(key);
      };

      const chartDatasets = (() => {
        const monthlyForecastMap = new Map<string, any>();
        for (const row of financeRevenueRows) {
          if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
          const monthKey = toMonthKey(row.monthEndDate);
          if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
          const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
            periodKey: monthKey,
            period: monthLabel(monthKey),
            plannedRevenue: 0,
            plannedCos: 0,
            grossProfit: 0,
          }));
          bucket.plannedRevenue += toNum(row.value);
        }
        for (const row of financeCosRows) {
          if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
          const monthKey = toMonthKey(row.monthEndDate);
          if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
          const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
            periodKey: monthKey,
            period: monthLabel(monthKey),
            plannedRevenue: 0,
            plannedCos: 0,
            grossProfit: 0,
          }));
          bucket.plannedCos += toNum(row.value);
        }
        if (monthlyForecastMap.size === 0) {
          for (const row of revenueRows) {
            if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
            const monthKey = toMonthKey(row.expectedPaymentDate || row.invoiceDate || row.paidDate);
            if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
            const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
              periodKey: monthKey,
              period: monthLabel(monthKey),
              plannedRevenue: 0,
              plannedCos: 0,
              grossProfit: 0,
            }));
            bucket.plannedRevenue += toNum(row.amountExVat);
          }
          for (const row of costRows) {
            if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
            const monthKey = toMonthKey(row.approvedDate || row.invoiceDate || row.paidDate);
            if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
            const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
              periodKey: monthKey,
              period: monthLabel(monthKey),
              plannedRevenue: 0,
              plannedCos: 0,
              grossProfit: 0,
            }));
            bucket.plannedCos += toNum(row.amountExVat);
          }
        }
        const monthlyForecastRows = Array.from(monthlyForecastMap.values())
          .sort((left: any, right: any) => left.periodKey.localeCompare(right.periodKey))
          .map((row: any) => ({ ...row, grossProfit: row.plannedRevenue - row.plannedCos }));

        const weeklyCashflowMap = new Map<string, any>();
        const cashflowMetricMap: Record<string, string> = {
          "planned revenue": "plannedRevenue",
          "planned expenditure": "plannedExpenditure",
          "planned cashflow": "plannedCashflow",
          "actual cashflow": "actualCashflow",
          "actual + planned revenue": "forecastRevenue",
          "actual + planned expenditure": "forecastExpenditure",
        };
        for (const row of cashflowPointRows) {
          if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
          const pointKey = toDateKey(row.pointDate);
          if (!pointKey || pointKey < fyStart || pointKey > fyEnd) continue;
          const bucket = ensureBucket(weeklyCashflowMap, pointKey, () => ({
            periodKey: pointKey,
            period: weekLabel(pointKey),
            plannedRevenue: 0,
            plannedExpenditure: 0,
            plannedCashflow: 0,
            actualCashflow: 0,
            forecastRevenue: 0,
            forecastExpenditure: 0,
          }));
          const metricKey = cashflowMetricMap[String(row.seriesName || '').toLowerCase()];
          if (metricKey) bucket[metricKey] += toNum(row.value);
        }
        if (weeklyCashflowMap.size === 0) {
          for (const row of revenueRows) {
            if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
            const plannedWeekKey = toWeekStartKey(row.expectedPaymentDate || row.invoiceDate || row.paidDate);
            if (plannedWeekKey && plannedWeekKey >= fyStart && plannedWeekKey <= fyEnd) {
              const bucket = ensureBucket(weeklyCashflowMap, plannedWeekKey, () => ({
                periodKey: plannedWeekKey,
                period: weekLabel(plannedWeekKey),
                plannedRevenue: 0,
                plannedExpenditure: 0,
                plannedCashflow: 0,
                actualCashflow: 0,
                forecastRevenue: 0,
                forecastExpenditure: 0,
              }));
              bucket.plannedRevenue += toNum(row.amountExVat);
              if (hasText(row.invoiceNumber) && hasText(row.paidDate) && isBlack(row.paidDateFontColor)) {
                bucket.actualCashflow += toNum(row.amountExVat);
              }
            }
          }
          for (const row of costRows) {
            if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
            const plannedWeekKey = toWeekStartKey(row.approvedDate || row.invoiceDate || row.paidDate);
            if (plannedWeekKey && plannedWeekKey >= fyStart && plannedWeekKey <= fyEnd) {
              const bucket = ensureBucket(weeklyCashflowMap, plannedWeekKey, () => ({
                periodKey: plannedWeekKey,
                period: weekLabel(plannedWeekKey),
                plannedRevenue: 0,
                plannedExpenditure: 0,
                plannedCashflow: 0,
                actualCashflow: 0,
                forecastRevenue: 0,
                forecastExpenditure: 0,
              }));
              bucket.plannedExpenditure += toNum(row.amountExVat);
              if (hasText(row.invoiceNumber) && hasText(row.paidDate) && isBlack(row.paidDateFontColor)) {
                bucket.actualCashflow -= toNum(row.amountExVat);
              }
            }
          }
        }
        const weeklyCashflowRows = Array.from(weeklyCashflowMap.values())
          .sort((left: any, right: any) => left.periodKey.localeCompare(right.periodKey))
          .map((row: any) => ({
            ...row,
            plannedCashflow: row.plannedCashflow || (row.plannedRevenue - row.plannedExpenditure),
            forecastRevenue: row.forecastRevenue || row.plannedRevenue,
            forecastExpenditure: row.forecastExpenditure || row.plannedExpenditure,
          }));

        const phaseSummaryMap = new Map<string, any>();
        for (const project of projects) {
          const key = String(project.executionPhase || project.rag || 'Unspecified');
          const bucket = ensureBucket(phaseSummaryMap, key, () => ({
            phase: key,
            projectCount: 0,
            contractValue: 0,
            openInflow: 0,
            openExpenditure: 0,
            averageProgress: 0,
            _progressSum: 0,
          }));
          const info = projectById.get(Number(project.projectId));
          bucket.projectCount += 1;
          bucket.contractValue += toNum(info?.contractValue);
          bucket.openInflow += toNum(project.openInflowFy);
          bucket.openExpenditure += toNum(project.openExpenditureFy);
          bucket._progressSum += toNum(project.actualProgressPct);
        }
        const phaseSummaryRows = Array.from(phaseSummaryMap.values())
          .sort((left: any, right: any) => right.projectCount - left.projectCount)
          .map((row: any) => ({
            phase: row.phase,
            projectCount: row.projectCount,
            contractValue: row.contractValue,
            openInflow: row.openInflow,
            openExpenditure: row.openExpenditure,
            averageProgress: row.projectCount ? row._progressSum / row.projectCount : 0,
          }));

        const pmSummaryMap = new Map<string, any>();
        for (const project of projects) {
          const key = String(project.pm || 'Unassigned');
          const bucket = ensureBucket(pmSummaryMap, key, () => ({
            owner: key,
            projectCount: 0,
            contractValue: 0,
            behindPlanCount: 0,
            onScheduleRate: 0,
            openInflow: 0,
            openExpenditure: 0,
            averageProgress: 0,
            _onScheduleCount: 0,
            _progressSum: 0,
          }));
          const info = projectById.get(Number(project.projectId));
          bucket.projectCount += 1;
          bucket.contractValue += toNum(info?.contractValue);
          bucket.behindPlanCount += project.actualProgressPct < project.expectedProgressPct - 5 ? 1 : 0;
          bucket._onScheduleCount += project.actualProgressPct >= project.expectedProgressPct - 5 ? 1 : 0;
          bucket.openInflow += toNum(project.openInflowFy);
          bucket.openExpenditure += toNum(project.openExpenditureFy);
          bucket._progressSum += toNum(project.actualProgressPct);
        }
        const pmSummaryRows = Array.from(pmSummaryMap.values())
          .sort((left: any, right: any) => right.contractValue - left.contractValue)
          .map((row: any) => ({
            owner: row.owner,
            projectCount: row.projectCount,
            contractValue: row.contractValue,
            behindPlanCount: row.behindPlanCount,
            onScheduleRate: row.projectCount ? (row._onScheduleCount / row.projectCount) * 100 : 0,
            openInflow: row.openInflow,
            openExpenditure: row.openExpenditure,
            averageProgress: row.projectCount ? row._progressSum / row.projectCount : 0,
          }));

        const milestonePipelineMap = new Map<string, any>();
        const milestoneFields = [
          { key: "pdHandovers", label: "PD Handover", planned: "pdHandoverDate", actual: "pdHandoverActual" },
          { key: "siteEstablishment", label: "Site Establishment", planned: "constructionStartDate", actual: "constructionStartActual" },
          { key: "commissioning", label: "Commissioning", planned: "commissioningDate", actual: "commissioningActual" },
          { key: "omHandover", label: "O&M Handover", planned: "omHandoverDate", actual: null },
          { key: "clientHandover", label: "Client Handover", planned: "clientHandoverDate", actual: "clientHandoverActual" },
        ];
        for (const info of visibleProjectInfo) {
          for (const field of milestoneFields) {
            const milestoneDate = toDateKey(field.actual ? info[field.actual] || info[field.planned] : info[field.planned]);
            if (!milestoneDate || milestoneDate < fyStart || milestoneDate > fyEnd) continue;
            const monthKey = milestoneDate.slice(0, 7);
            const bucket = ensureBucket(milestonePipelineMap, monthKey, () => ({
              periodKey: monthKey,
              period: monthLabel(monthKey),
              pdHandovers: 0,
              siteEstablishment: 0,
              commissioning: 0,
              omHandover: 0,
              clientHandover: 0,
            }));
            bucket[field.key] += 1;
          }
        }
        const milestonePipelineRows = Array.from(milestonePipelineMap.values()).sort((left: any, right: any) => left.periodKey.localeCompare(right.periodKey));

        const nextTenDays = new Date(`${today}T00:00:00`);
        nextTenDays.setDate(nextTenDays.getDate() + 10);
        const constructionWindowRows = milestoneFields.map((field) => {
          let next10DaysCount = 0;
          let overdueCount = 0;
          let completedCount = 0;
          for (const info of visibleProjectInfo) {
            const plannedDate = toDateKey(info[field.planned]);
            const actualDate = field.actual ? toDateKey(info[field.actual]) : null;
            const effectiveDate = actualDate || plannedDate;
            if (actualDate) completedCount += 1;
            if (plannedDate && !actualDate && plannedDate < today) overdueCount += 1;
            if (effectiveDate) {
              const date = new Date(`${effectiveDate}T00:00:00`);
              if (!Number.isNaN(date.getTime()) && date >= new Date(`${today}T00:00:00`) && date <= nextTenDays) {
                next10DaysCount += 1;
              }
            }
          }
          return {
            milestone: field.label,
            next10Days: next10DaysCount,
            overdue: overdueCount,
            completed: completedCount,
          };
        });

        const datasets = [
          {
            id: "monthlyForecast",
            label: "2026 Forecast",
            description: "Monthly revenue, COS, and GP from imported finance pivots with tracker fallback.",
            dimensionKey: "period",
            dimensionLabel: "Month",
            defaultChartType: "line",
            allowedChartTypes: ["line", "area", "bar", "composed"],
            metrics: [
              { key: "plannedRevenue", label: "Revenue", format: "currency", color: "#0f766e" },
              { key: "plannedCos", label: "COS", format: "currency", color: "#ea580c" },
              { key: "grossProfit", label: "GP", format: "currency", color: "#1d4ed8" },
            ],
            rows: monthlyForecastRows,
          },
          {
            id: "weeklyCashflow",
            label: "Cashflow Current & Forecast",
            description: "Weekly cashflow built from imported cashflow sheet series with finance-line fallback.",
            dimensionKey: "period",
            dimensionLabel: "Week",
            defaultChartType: "line",
            allowedChartTypes: ["line", "area", "bar", "composed"],
            metrics: [
              { key: "actualCashflow", label: "Actual Cashflow", format: "currency", color: "#047857" },
              { key: "plannedCashflow", label: "Planned Cashflow", format: "currency", color: "#2563eb" },
              { key: "plannedRevenue", label: "Planned Revenue", format: "currency", color: "#14b8a6" },
              { key: "plannedExpenditure", label: "Planned Expenditure", format: "currency", color: "#f97316" },
            ],
            rows: weeklyCashflowRows,
          },
          {
            id: "phaseSummary",
            label: "Count of Project Name by Phase",
            description: "Visible project population grouped by execution phase.",
            dimensionKey: "phase",
            dimensionLabel: "Phase",
            defaultChartType: "bar",
            allowedChartTypes: ["bar", "line", "area", "composed"],
            metrics: [
              { key: "projectCount", label: "Projects", format: "number", color: "#2563eb" },
              { key: "contractValue", label: "Contract Value", format: "currency", color: "#0f766e" },
              { key: "averageProgress", label: "Avg Progress", format: "percent", color: "#7c3aed" },
            ],
            rows: phaseSummaryRows,
          },
          {
            id: "pmSummary",
            label: "PM Delivery Breakdown",
            description: "Operational PM view built from the filtered project population.",
            dimensionKey: "owner",
            dimensionLabel: "PM",
            defaultChartType: "bar",
            allowedChartTypes: ["bar", "line", "area", "composed"],
            metrics: [
              { key: "projectCount", label: "Projects", format: "number", color: "#2563eb" },
              { key: "onScheduleRate", label: "On Schedule Rate", format: "percent", color: "#0f766e" },
              { key: "behindPlanCount", label: "Slipping Projects", format: "number", color: "#dc2626" },
              { key: "contractValue", label: "Contract Value", format: "currency", color: "#7c3aed" },
            ],
            rows: pmSummaryRows,
          },
          {
            id: "milestonePipeline",
            label: "Portfolio Timeline",
            description: "Month-by-month milestone pipeline from imported project dates.",
            dimensionKey: "period",
            dimensionLabel: "Month",
            defaultChartType: "bar",
            allowedChartTypes: ["bar", "area", "line", "composed"],
            metrics: [
              { key: "pdHandovers", label: "PD Handover", format: "number", color: "#0f766e" },
              { key: "siteEstablishment", label: "Site Establishment", format: "number", color: "#2563eb" },
              { key: "commissioning", label: "Commissioning", format: "number", color: "#f97316" },
              { key: "omHandover", label: "O&M Handover", format: "number", color: "#7c3aed" },
              { key: "clientHandover", label: "Client Handover", format: "number", color: "#dc2626" },
            ],
            rows: milestonePipelineRows,
          },
          {
            id: "constructionWindow",
            label: "Construction Window",
            description: "Upcoming, overdue, and completed milestones from the current execution population.",
            dimensionKey: "milestone",
            dimensionLabel: "Milestone",
            defaultChartType: "bar",
            allowedChartTypes: ["bar", "line", "area", "composed"],
            metrics: [
              { key: "next10Days", label: "Next 10 Days", format: "number", color: "#2563eb" },
              { key: "overdue", label: "Overdue", format: "number", color: "#dc2626" },
              { key: "completed", label: "Completed", format: "number", color: "#0f766e" },
            ],
            rows: constructionWindowRows,
          },
        ];

        const presets = [
          {
            id: "forecast-2026",
            title: "2026 Forecast",
            description: "Workbook-style forecast view built from imported monthly finance data.",
            datasetId: "monthlyForecast",
            chartType: "line",
            metricKeys: ["plannedRevenue", "plannedCos", "grossProfit"],
          },
          {
            id: "cashflow-current-forecast",
            title: "Cashflow Current & Forecast",
            description: "Weekly actual vs planned cashflow from the imported cashflow model.",
            datasetId: "weeklyCashflow",
            chartType: "line",
            metricKeys: ["actualCashflow", "plannedCashflow"],
          },
          {
            id: "count-by-phase",
            title: "Count of Project Name by Phase",
            description: "Execution phase distribution for the visible project set.",
            datasetId: "phaseSummary",
            chartType: "bar",
            metricKeys: ["projectCount"],
          },
          {
            id: "portfolio-timeline",
            title: "Portfolio Gantt Chart",
            description: "Milestone pipeline across the portfolio using imported project dates.",
            datasetId: "milestonePipeline",
            chartType: "bar",
            metricKeys: ["pdHandovers", "siteEstablishment", "commissioning", "omHandover", "clientHandover"],
            stacked: true,
          },
          {
            id: "construction-window",
            title: "Construction",
            description: "Upcoming and overdue execution milestones over the next ten days.",
            datasetId: "constructionWindow",
            chartType: "bar",
            metricKeys: ["next10Days", "overdue", "completed"],
          },
          {
            id: "pm-delivery",
            title: "PM Delivery Breakdown",
            description: "Operational PM performance from the same filtered project population.",
            datasetId: "pmSummary",
            chartType: "bar",
            metricKeys: ["onScheduleRate", "behindPlanCount"],
          },
        ];

        return {
          supportedChartTypes: ["line", "area", "bar", "composed"],
          presets,
          datasets,
        };
      })();

      const sum = (f: string) => projects.reduce((a: number, p: any) => a + toNum(p[f]), 0);
      const avg = (f: string) => projects.length ? sum(f) / projects.length : 0;

      const actionRows = (items: any[]) => items.map((x: any) => ({
        projectId: x.projectId,
        project: x.projectName,
        issueTitle: x.issueTitle,
        severity: x.severity,
        owner: x.owner || null,
        dueDate: x.dueDate || null,
        links: {
          project: `/project/${encodeURIComponent(x.projectName)}`,
          plan: `/project/${encodeURIComponent(x.projectName)}?tab=plan`,
          revenue: `/project/${encodeURIComponent(x.projectName)}?tab=revenue-tracking`,
          expenditure: `/project/${encodeURIComponent(x.projectName)}?tab=expenditure`,
        }
      }));

      const behind = actionRows(projects.filter((p: any) => p.actualProgressPct < p.expectedProgressPct - 5).map((p: any) => ({
        ...p, issueTitle: `Actual ${Number(p.actualProgressPct).toFixed(1)}% vs Expected ${Number(p.expectedProgressPct).toFixed(1)}%`, severity: (p.expectedProgressPct - p.actualProgressPct) > 15 ? 'Critical' : 'High', owner: p.pm
      })));
      const fmtR = (v: number) => `R${Math.round(v).toLocaleString()}`;
      const inflow = actionRows(projects.filter((p: any) => p._inflowRisk > 0).map((p: any) => {
        const openPct = p.plannedRevenueFy > 0 ? Math.round((p.openInflowFy / p.plannedRevenueFy) * 100) : 0;
        return { ...p, issueTitle: `${fmtR(p.openInflowFy)} open of ${fmtR(p.plannedRevenueFy)} planned (${openPct}% outstanding)`, severity: openPct > 60 ? 'Critical' : 'High', owner: p.pm };
      }));
      const outflow = actionRows(projects.filter((p: any) => p._outflowRisk > 0).map((p: any) => {
        const openPct = p.plannedExpenditureFy > 0 ? Math.round((p.openExpenditureFy / p.plannedExpenditureFy) * 100) : 0;
        return { ...p, issueTitle: `${fmtR(p.openExpenditureFy)} open of ${fmtR(p.plannedExpenditureFy)} planned (${openPct}% outstanding)`, severity: openPct > 60 ? 'Critical' : 'High', owner: p.pm };
      }));
      const eng = actionRows(projects.filter((p: any) => p._engOpen > 0).map((p: any) => ({ ...p, issueTitle: `${p._engOpen} open engineering blocker${p._engOpen !== 1 ? 's' : ''}`, severity: p._engOpen >= 5 ? 'Critical' : 'High', owner: p.pm })));
      const qual = actionRows(projects.filter((p: any) => p._qualityOpen > 0).map((p: any) => ({ ...p, issueTitle: `${p._qualityOpen} open quality issue${p._qualityOpen !== 1 ? 's' : ''}`, severity: p._qualityOpen >= 5 ? 'Critical' : 'High', owner: p.pm })));
      const pending = actionRows(projects.filter((p: any) => p._approvalsPending > 0).map((p: any) => ({ ...p, issueTitle: `${p._approvalsPending} pending approval${p._approvalsPending !== 1 ? 's' : ''}`, severity: p._approvalsPending >= 3 ? 'Critical' : 'High', owner: p.pm })));

      res.json({
        meta: { fyStart, fyEnd },
        kpis: {
          activeDashboardProjects: projects.length,
          averageActualProgressPct: avg('actualProgressPct'),
          averageExpectedProgressPct: avg('expectedProgressPct'),
          projectsBehindPlan: projects.filter((p: any) => p.actualProgressPct < p.expectedProgressPct - 5).length,
          plannedRevenueFy: sum('plannedRevenueFy'),
          receivedInflowFy: sum('receivedInflowFy'),
          openInflowFy: sum('openInflowFy'),
          plannedExpenditureFy: sum('plannedExpenditureFy'),
          paidExpenditureFy: sum('paidExpenditureFy'),
          openExpenditureFy: sum('openExpenditureFy'),
          grossProfitFy: sum('plannedRevenueFy') - sum('plannedExpenditureFy'),
          grossMarginPctFy: computeMarginPct(sum('plannedRevenueFy'), sum('plannedExpenditureFy'), { precision: 1 }),
          openEngineeringBlockers: sum('_engOpen'),
          openQualityWarnings: sum('_qualityOpen'),
          pendingApprovals: sum('_approvalsPending'),
          staleImports: projects.filter((p: any) => p.importFreshness !== 'Fresh').length,
          cosPlannedMonth,
          cosRealisedMonth,
          currentMonth: currentMonthKey,
        },
        actionCenter: {
          projectsBehindPlan: behind,
          inflowAtRisk: inflow,
          expenditureAtRisk: outflow,
          engineeringBottlenecks: eng,
          qualityIssues: qual,
          pendingApprovalsDecisions: pending,
        },
        projects: projects.map(({ _taskWeight, _taskActual, _taskExpected, _expCount, _engOpen, _qualityOpen, _approvalsPending, _inflowRisk, _outflowRisk, __hasFyItem, ...rest }: any) => rest),
        charts: chartDatasets,
        options: {
          portfolios: Array.from(new Set(projects.map((p: any) => p.portfolio).filter(Boolean))).sort(),
          pms: Array.from(new Set(projects.map((p: any) => p.pm).filter(Boolean))).sort(),
          pds: Array.from(new Set(projects.map((p: any) => p.pd).filter(Boolean))).sort(),
          executionPhases: Array.from(new Set(projects.map((p: any) => p.executionPhase).filter(Boolean))).sort(),
          rags: Array.from(new Set(projects.map((p: any) => p.rag).filter(Boolean))).sort(),
        }
      });
    } catch (error) {
      console.error("Program dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch program dashboard", message: "Failed to fetch program dashboard" });
    }
  });

  app.get("/api/dashboard/high-priority", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, legacyExpenses, legacyRawInflows, legacyRawPlans, allPlanOverrides, allTaskLinks, allOpTasks, inBankOverrides] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        Promise.resolve([]),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        Promise.resolve([]),
      ]);
      const allExpenses = legacyExpenses;
      const allPlans = legacyRawPlans;

      const inBankOverrideSet = new Set(
        inBankOverrides
          .filter(o => o.overrideValue === "1")
          .map(o => `${o.projectName}::${o.rowNumber}`)
      );

      const allInflows = resolveInflowEffectiveDates(legacyRawInflows, allTaskLinks, allOpTasks, allPlans);

      const today = new Date().toISOString().split("T")[0];
      const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

      const nowDate = new Date();
      const fyStartMonth = 9;
      const fyStartYear = nowDate.getMonth() + 1 >= fyStartMonth ? nowDate.getFullYear() : nowDate.getFullYear() - 1;
      const fyStart = `${fyStartYear}-09-01`;
      const fyEnd = `${fyStartYear + 1}-08-31`;
      function isMegaParkOutsideFY(projectName: string, dateStr: string): boolean {
        return /mega\s*park/i.test(projectName) && (dateStr < fyStart || dateStr > fyEnd);
      }

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
        if (!expense.expenseActualTotal) continue;
        const amt = parseFloat(expense.expenseActualTotal) || 0;
        if (amt <= 0) continue;
        const state = expense.computedState || '';
        if (state !== 'Invoiced' && state !== 'Committed') continue;
        const overdueDate = expense.expensePaymentDate || expense.expenseInvoicedDate;
        if (!overdueDate || !(/^\d{4}-\d{2}-\d{2}/.test(overdueDate)) || overdueDate >= today) continue;
        if (isMegaParkOutsideFY(expense.projectName, overdueDate)) continue;
        overdueExpenses.push({
          id: expense.id,
          projectName: expense.projectName,
          lineItem: expense.expenseLineItem,
          invoiceNumber: expense.expenseInvoiceNumber,
          poNumber: expense.expensePoNumber,
          amount: amt,
          paymentDate: overdueDate,
          severity: amt >= 500000 ? "Critical" : amt >= 100000 ? "High" : "Medium",
          hasInvoice: !!expense.expenseInvoiceNumber && expense.expenseInvoiceNumber.trim() !== '',
        });
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
          const rawInBank = (inflow as any).inBank === 1 || (inflow as any).inBank === '1' || (inflow as any).inBank === true;
          const overrideInBank = inBankOverrideSet.has(`${inflow.projectName}::${inflow.rowNumber}`);
          const dateToCheck = inflow.effectiveDate || inflow.invoiceRaisedDate;
          const arState = evaluateRevenueArStatus({
            status: inflow.lineStatus || inflow.status || inflow.computedState || null,
            manualInBank: rawInBank || overrideInBank,
            paymentReceivedDate: inflow.paymentReceivedDate,
            dueDate: dateToCheck,
            invoiceNumber: inflow.milestoneInvoiceNumber,
            amount: amt,
            today,
          });

          if (arState.isOverdue) {
            if (dateToCheck && isMegaParkOutsideFY(inflow.projectName, dateToCheck)) continue;
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
        if ((plan as any).rowNumber < 0 && (plan as any).isVirtual) continue;
        if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
        plansByProject.get(plan.projectName)!.push(plan);
      }

      const todayDate = new Date().toISOString().split("T")[0];
      for (const [projectName, plans] of Array.from(plansByProject.entries())) {
        const info = projectInfoMap.get(projectName);
        if (info && (info as any).isActive === false) continue;
        let totalW = 0, wActual = 0, wExpected = 0;
        let hasSummaryRow = false;
        for (const p of plans as any[]) {
          const taskNo2 = (p.taskNo || '').toString().toLowerCase().trim();
          if (taskNo2 === 'no.' || taskNo2 === 'no' || taskNo2 === '#') {
            const act = p.actualPctComplete != null ? Number(p.actualPctComplete) : 0;
            const exp = p.expectedPctComplete != null ? Number(p.expectedPctComplete) : 0;
            wActual = act;
            wExpected = exp;
            totalW = 1;
            hasSummaryRow = true;
            break;
          }
        }
        if (!hasSummaryRow) {
          for (const p of plans as any[]) {
            const taskNo2 = (p.taskNo || '').toString().toLowerCase().trim();
            if (taskNo2 === 'no.' || taskNo2 === 'no' || taskNo2 === '#') continue;
            const dur = p.durationDays && p.durationDays > 0 ? p.durationDays : 1;
            const act = p.actualPctComplete != null ? Number(p.actualPctComplete) : 0;
            let exp = p.expectedPctComplete != null ? Number(p.expectedPctComplete) : null;
            if (exp == null && p.actualStart && p.actualEnd) {
              const tStart = (p.actualStart || '').substring(0, 10);
              const tEnd = (p.actualEnd || '').substring(0, 10);
              if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
                if (todayDate >= tEnd) { exp = 1.0; }
                else if (todayDate <= tStart) { exp = 0; }
                else {
                  const totalWd = saWorkingDays(tStart, tEnd);
                  const elapsedWd = saWorkingDays(tStart, todayDate);
                  if (totalWd && totalWd > 0 && elapsedWd != null) {
                    exp = Math.min(1, elapsedWd / totalWd);
                  }
                }
              }
            }
            wActual += act * dur;
            wExpected += (exp ?? 0) * dur;
            totalW += dur;
          }
        }
        if (totalW > 0) {
          const avgActual = hasSummaryRow ? wActual : wActual / totalW;
          const avgExpected = hasSummaryRow ? wExpected : wExpected / totalW;
          const delta = avgActual - avgExpected;
          if (delta < -0.05) {
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

      const threeWeeksFromNow = new Date();
      threeWeeksFromNow.setDate(threeWeeksFromNow.getDate() + 21);
      const threeWeeksCutoff = threeWeeksFromNow.toISOString().split("T")[0];

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const oneWeekAgoCutoff = oneWeekAgo.toISOString().split("T")[0];

      for (const inflow of allInflows) {
        const amt = inflow.milestoneAmount ? parseFloat(inflow.milestoneAmount) : 0;
        if (amt <= 0) continue;
        const receivedDate = inflow.paymentReceivedDate && inflow.paymentReceivedDate.trim() !== '' ? inflow.paymentReceivedDate.trim() : null;
        if (receivedDate && /^\d{4}-\d{2}-\d{2}/.test(receivedDate) && receivedDate <= today) continue;
        const effectiveDate = (inflow as any).effectiveDate || inflow.plannedPaymentDate;
        if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}/.test(effectiveDate)) continue;
        if (effectiveDate < oneWeekAgoCutoff) continue;
        if (effectiveDate > threeWeeksCutoff) continue;
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
            if (endDate < fyStart) continue;
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

  app.get("/api/dashboard", requireAuth, async (req, res) => {
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

  app.get("/api/dashboard/import-health", requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      const history = [
        { timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(), status: "success", recordsProcessed: 150, errors: 0 },
        { timestamp: new Date(now - 7 * 60 * 60 * 1000).toISOString(), status: "partial", recordsProcessed: 120, errors: 3 },
        { timestamp: new Date(now - 30 * 60 * 60 * 1000).toISOString(), status: "failed", recordsProcessed: 0, errors: 6 },
      ] as const;
      res.json({
        lastImportTime: history[0].timestamp,
        lastImportStatus: history[0].status,
        errorCount: history.reduce((sum, h) => sum + h.errors, 0),
        pendingValidations: 5,
        importHistory: history,
      });
    } catch (error) {
      console.error("Import health API error:", error);
      res.status(500).json({ error: "Failed to fetch import health" });
    }
  });

  app.get("/api/dashboard/attention-items", requireAuth, async (_req, res) => {
    try {
      res.json({
        behindPlan: [
          { id: 1, name: "Solar Farm Alpha", owner: "John", daysBehind: 12, ageDays: 12, severity: "high", link: "/projects/1" },
          { id: 2, name: "Wind Cluster Beta", owner: "Anna", daysBehind: 8, ageDays: 8, severity: "medium", link: "/projects/2" },
        ],
        engineeringBlockers: [
          { id: 11, name: "Grid Study Delay", owner: "Sam", ageDays: 6, severity: "high", link: "/engineering" },
        ],
        qualityWarnings: [
          { id: 21, name: "Commissioning Punchlist", owner: "Lebo", ageDays: 5, severity: "medium", link: "/quality" },
        ],
        overdueActions: [
          { id: 31, name: "Approve Variation 112", owner: "Finance Ops", ageDays: 4, severity: "high", link: "/approvals" },
        ],
      });
    } catch (error) {
      console.error("Attention items API error:", error);
      res.status(500).json({ error: "Failed to fetch attention items" });
    }
  });

  app.get("/api/dashboard/financial-summary", requireAuth, async (req, res) => {
    try {
      const period = String(req.query.period || "ytd");
      res.json({
        period,
        metrics: [
          {
            key: "revenue",
            label: "Revenue",
            plan: 12000000,
            actual: 11100000,
            forecast: 12500000,
            trend: [
              { month: "Oct", value: 1600000 },
              { month: "Nov", value: 1700000 },
              { month: "Dec", value: 1800000 },
              { month: "Jan", value: 1900000 },
              { month: "Feb", value: 2050000 },
              { month: "Mar", value: 2200000 },
            ],
          },
          {
            key: "cos",
            label: "Cost of Sales",
            plan: 7600000,
            actual: 8100000,
            forecast: 8400000,
            trend: [
              { month: "Oct", value: 900000 },
              { month: "Nov", value: 1100000 },
              { month: "Dec", value: 1200000 },
              { month: "Jan", value: 1300000 },
              { month: "Feb", value: 1500000 },
              { month: "Mar", value: 1600000 },
            ],
          },
          {
            key: "opex",
            label: "Operating Expenditure",
            plan: 1200000,
            actual: 980000,
            forecast: 1150000,
            trend: [
              { month: "Oct", value: 180000 },
              { month: "Nov", value: 150000 },
              { month: "Dec", value: 160000 },
              { month: "Jan", value: 170000 },
              { month: "Feb", value: 160000 },
              { month: "Mar", value: 160000 },
            ],
          },
        ],
      });
    } catch (error) {
      console.error("Financial summary API error:", error);
      res.status(500).json({ error: "Failed to fetch financial summary" });
    }
  });

  app.get("/api/dashboard/my-work", requireAuth, async (req, res) => {
    try {
      const role = String((req as any).user?.role || "USER").toUpperCase();
      const roleView =
        role.includes("FINANCE") || role === "CFO" ? "Finance focus" :
        role.includes("ENGINEER") ? "Engineering focus" :
        role.includes("ADMIN") ? "Admin focus" :
        role.includes("PROJECT") || role.includes("PM") ? "PM focus" : "General";

      res.json({
        overdueTasks: [{ id: 1, title: "Review delayed milestone: Solar Farm Alpha", link: "/my-work/tasks" }],
        dueTodayTasks: [{ id: 2, title: "Approve contractor invoice INV-3442", link: "/approvals" }],
        upcomingTasks: [{ id: 3, title: "Prepare weekly status update", link: "/execution-board" }],
        pendingApprovals: [{ id: 4, title: "CAPEX change request #128", link: "/approvals" }],
        recentMentions: [{ id: 5, title: "@you in Engineering blocker thread", link: "/teams-chats" }],
        assignedProjects: [{ id: 6, title: "Solar Farm Alpha", link: "/projects/1" }],
        roleView,
      });
    } catch (error) {
      console.error("My work dashboard API error:", error);
      res.status(500).json({ error: "Failed to fetch my work" });
    }
  });
}
