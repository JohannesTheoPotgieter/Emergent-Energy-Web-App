/**
 * Home / Reporting Routes — Extracted from server/routes.ts (Phase 7)
 *
 * 5 handlers:
 *   GET  /api/home/summary
 *   GET  /api/home/notes
 *   POST /api/home/notes
 *   GET  /api/upcoming-events
 *   GET  /api/upcoming-financials
 */

import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { and, isNull } from "drizzle-orm";
import { normalizedCostLines, normalizedRevenueLines } from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import { resolveInflowEffectiveDates } from "../lib/cashflow-helpers";
import { getAllPMWorkItemsAsProjectPlan, getAllWorkItemsForProgress } from "../work-items-adapter";
import { computeAllProjectPlanPills } from "../services/plan-rollup-service";
import { safeNum, isWithinDays, isThisWeek, isThisMonth, getFYRange, findMaxEndDate, findMinStartDate } from "../lib/home-helpers";
import { getCanonicalAllCurrentCostLines } from "../services/project-cost-line-read-service";
import { getRepoRevenueTotals } from "../lib/finance/revenue-recognition-repo";
import { FinanceLineLevelRepository } from "../repositories/finance-line-level-repository";

export function registerHomeExtractedRoutes(app: Express): void {

  // ==================== HOME SUMMARY ====================

  app.get("/api/home/summary", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, legacyExpenses, legacyRawInflows, legacyPlans, latestRefresh, revenueSummaries, allTaskLinks, allOpTasks, allPlanOverrides, allPlanTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        getCanonicalAllCurrentCostLines(),
        storage.getAllRevenueLinesForCashflow(),
        storage.getAllProjectPlans(),
        storage.getLatestRefresh(),
        storage.getAllProjectRevenueSummaries(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        Promise.resolve([]),
        getAllPMWorkItemsAsProjectPlan(),
      ]);
      const allExpenses = legacyExpenses;
      const allPlans = legacyPlans;
      const allInflows = resolveInflowEffectiveDates(legacyRawInflows, allTaskLinks, allOpTasks, allPlans);

      const today = new Date().toISOString().split("T")[0];
      const fyRange = getFYRange();

      // Active projects = those not in "Closed" or "On Hold" phase
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

      // Active capacity (MW) = sum(sizeKwp)/1000 for active projects
      let activeCapacityKw = 0;
      for (const p of activeProjects) {
        activeCapacityKw += safeNum(p.sizeKwp);
      }
      const activeCapacityMW = activeCapacityKw / 1000;

      // Construction capacity
      let constructionCapacityKw = 0;
      for (const p of constructionProjects) {
        constructionCapacityKw += safeNum(p.sizeKwp);
      }

      // Phase distribution
      const phaseDistribution: Record<string, { count: number; kw: number }> = {};
      for (const p of allProjectInfo) {
        const phase = p.phase || 'Unknown';
        if (!phaseDistribution[phase]) {
          phaseDistribution[phase] = { count: 0, kw: 0 };
        }
        phaseDistribution[phase].count++;
        phaseDistribution[phase].kw += safeNum(p.sizeKwp);
      }

      // 2026-05-19: COO Home consumes the Plan-tab pill service so the
      // on-schedule / behind-schedule counts here match every other
      // surface (project detail Plan tab pill, Schedule Status modal,
      // Program Dashboard, Execution Dashboard) and the Excel project-plan
      // top-row rollup. See server/services/plan-rollup-service.ts.
      const planPillsHome = await computeAllProjectPlanPills({ workstream: 'PM' });
      const projectDeltaValues: { projectName: string; delta: number; avgActual: number; avgExpected: number }[] = [];
      for (const pill of planPillsHome.values()) {
        if (pill.leafCount > 0 && pill.actualPct != null && pill.expectedPct != null) {
          projectDeltaValues.push({
            projectName: pill.projectName,
            delta: (pill.actualPct as number) - (pill.expectedPct as number),
            avgActual: pill.actualPct as number,
            avgExpected: pill.expectedPct as number,
          });
        }
      }

      // On schedule = delta >= 0
      const onScheduleProjects = projectDeltaValues.filter(p => p.delta >= 0);
      const behindPlanProjects = projectDeltaValues.filter(p => p.delta < 0);
      const onScheduleRate = projectDeltaValues.length > 0 
        ? (onScheduleProjects.length / projectDeltaValues.length) * 100 
        : 0;

      // Top 5 behind plan (most negative delta)
      const top5BehindPlan = [...behindPlanProjects]
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 5);

      // Construction-specific metrics
      const constructionProjectNames = new Set(constructionProjects.map(p => p.projectName));
      const constructionDeltas = projectDeltaValues.filter(p => constructionProjectNames.has(p.projectName));
      const avgConstructionComplete = constructionDeltas.length > 0
        ? constructionDeltas.reduce((sum, p) => sum + p.avgActual, 0) / constructionDeltas.length
        : 0;
      const avgConstructionDelta = constructionDeltas.length > 0
        ? constructionDeltas.reduce((sum, p) => sum + p.delta, 0) / constructionDeltas.length
        : 0;
      const constructionBehindCount = constructionDeltas.filter(p => p.delta < 0).length;

      // Build per-project milestone dates from plan work items (actual dates from smart import)
      const planTasksByProject = new Map<number, typeof allPlanTasks>();
      for (const t of allPlanTasks) {
        if (!t.projectId) continue;
        if (!planTasksByProject.has(t.projectId)) planTasksByProject.set(t.projectId, []);
        planTasksByProject.get(t.projectId)!.push(t);
      }

      function getProjectMilestoneDate(p: any): {
        constructionStart: string | null;
        commissioning: string | null;
        omHandover: string | null;
        clientHandover: string | null;
      } {
        const tasks = p.id ? (planTasksByProject.get(p.id) || []) : [];
        const csFromPlan = findMinStartDate(tasks, ['site establishment']);
        const commFromPlan = findMaxEndDate(tasks, ['commissioning']);
        const omFromPlan = findMaxEndDate(tasks, ['handover to matriarch']);
        const chFromPlan = findMaxEndDate(tasks, ['handover to client']);
        return {
          constructionStart: csFromPlan || p.constructionStartDate || null,
          commissioning: commFromPlan || p.commissioningDate || null,
          omHandover: omFromPlan || p.omHandoverDate || null,
          clientHandover: chFromPlan || p.clientHandoverDate || null,
        };
      }

      // Upcoming events (next 7 days) — using actual dates from plan work items
      let constructionStartSoon = 0, commissioningSoon = 0, omHandoverSoon = 0, clientHandoverSoon = 0;
      let commissioningDue30 = 0, omHandoverDue30 = 0, clientHandoverDue30 = 0;
      for (const p of allProjectInfo) {
        const dates = getProjectMilestoneDate(p);
        if (isWithinDays(dates.constructionStart, 7)) constructionStartSoon++;
        if (isWithinDays(dates.commissioning, 7)) commissioningSoon++;
        if (isWithinDays(dates.omHandover, 7)) omHandoverSoon++;
        if (isWithinDays(dates.clientHandover, 7)) clientHandoverSoon++;
        if (isWithinDays(dates.commissioning, 30)) commissioningDue30++;
        if (isWithinDays(dates.omHandover, 30)) omHandoverDue30++;
        if (isWithinDays(dates.clientHandover, 30)) clientHandoverDue30++;
      }

      // Financial summary — CANONICAL Revenue Recognition (POC method).
      // actualRevenue = sum of revenue_recognition_amount on cost lines whose
      // underlying COS is effectively realised (past-month auto-promote +
      // canonical strict realisation check). This matches the Revenue Tracker
      // and FY Revenue Tracker. Cash inflows / outstanding AR are reported
      // separately below.
      let actualRevenue = 0, actualExpenses = 0, currentVoTotal = 0;
      // POC revenue via the § 3.3.2 single read path (P2.1c): planned = Σ
      // perLineRevenue; realised = Σ on canonical realised lines. Scope = the
      // projects present in allExpenses.
      const repoHm = new FinanceLineLevelRepository();
      const repoRevenueHm = await getRepoRevenueTotals(
        repoHm,
        allExpenses.map((e: any) => e.projectId),
      );
      actualRevenue = repoRevenueHm.realised;
      const plannedRevenue = repoRevenueHm.planned;
      for (const expense of allExpenses) {
        if (expense.expenseActualTotal) {
          const state = classifyExpenseState(expense as any);
          if (state === 'Paid') {
            actualExpenses += safeNum(expense.expenseActualTotal);
          }
        }
      }
      // VO totals still come from the legacy revenue summaries table.
      for (const rs of revenueSummaries) {
        currentVoTotal += safeNum(rs.currentVoTotal);
      }
      const grossProfit = actualRevenue - actualExpenses;
      const grossProfitPercent = actualRevenue > 0 ? (grossProfit / actualRevenue) * 100 : 0;

      let revenueOutstanding = 0;
      for (const inf of allInflows) {
        if (inf.milestoneAmount) {
          const hasInvoice = !!(inf.milestoneInvoiceNumber && inf.milestoneInvoiceNumber.trim());
          const hasPaidDate = inf.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inf.paymentReceivedDate);
          const paidClr = inf.paidDateFontColor ?? null;
          const paidConf = inf.paidDateConfirmed;
          const hasColorInfo = (paidConf != null && paidConf !== false) || (paidClr != null && paidClr !== '');
          const paidBlack = hasPaidDate && (paidConf === true || paidClr === 'black' || !hasColorInfo);
          const isInBank = hasInvoice && paidBlack;
          if (hasInvoice && !isInBank) {
            revenueOutstanding += safeNum(inf.milestoneAmount);
          }
        }
      }

      // Expenses outstanding = invoiced but not paid
      let expensesOutstanding = 0;
      for (const exp of allExpenses) {
        if (exp.expenseInvoicedDate && !exp.expensePaymentDate && exp.expenseActualTotal) {
          expensesOutstanding += safeNum(exp.expenseActualTotal);
        }
      }

      // This week cashflows (uses effective date from revenue tab hierarchy)
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

      // This month outstanding
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

      // Data quality checks
      const missingPhase = allProjectInfo.filter(p => !p.phase).length;
      const missingKwp = allProjectInfo.filter(p => !p.sizeKwp || safeNum(p.sizeKwp) === 0).length;
      const missingCommissioning = allProjectInfo.filter(p => !getProjectMilestoneDate(p).commissioning).length;

      res.json({
        lastRefresh: latestRefresh?.refreshedAt || null,
        fyRange,
        portfolio: {
          activeProjects: activeProjects.length,
          activeCapacityMW,
          onScheduleRate,
          projectsBehindPlan: behindPlanProjects.length,
          contractPackComplete: null, // Not tracked - will show as "—"
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

  // Get/Save home notes
  app.get("/api/home/notes", requireAuth, async (req, res) => {
    try {
      const notes = await storage.getHomeNotes();
      res.json(notes || { highlightsNotes: '', constructionNotes: '', financeNotes: '', preparedBy: '' });
    } catch (error) {
      console.error("Home notes fetch error:", error);
      res.status(500).json({ error: "Failed to fetch home notes" });
    }
  });

  app.post("/api/home/notes", requireAuth, requireAdmin, async (req, res) => {
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
      logAuditFromReq(req, { entityType: "home_notes", action: "update", changesJson: { description: "Home notes updated", preparedBy } });
      res.json(result);
    } catch (error) {
      console.error("Home notes save error:", error);
      res.status(500).json({ error: "Failed to save home notes" });
    }
  });

  // ==================== UPCOMING EVENTS / FINANCIALS ====================

  app.get("/api/upcoming-events", requireAuth, async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Rolling 4-week look ahead — start on the Monday of the current week
      // so the calendar grid always begins on a Monday and spans 28 days.
      const startDate = new Date(today);
      const dow = startDate.getDay(); // 0 = Sun, 1 = Mon, ...
      const daysSinceMonday = (dow + 6) % 7;
      startDate.setDate(startDate.getDate() - daysSinceMonday);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 27);
      // Use local-date formatting (NOT toISOString) so a server in UTC+2 doesn't
      // shift local-midnight Monday into the previous UTC Sunday.
      const fmtLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const rangeStart = fmtLocal(startDate);
      const rangeEnd = fmtLocal(endDate);

      type UpcomingEvent = { type: string; date: string; projectName: string; projectId: number | null; detail: string; amount?: string };
      const events: UpcomingEvent[] = [];

      const planTasks = await getAllPMWorkItemsAsProjectPlan();

      const milestoneMatchers: Array<{ type: string; detail: string; patterns: string[]; mode: "end" | "start" }> = [
        { type: "site_establishment", detail: "Site Establishment", patterns: ["site establishment"], mode: "start" },
        { type: "commissioning", detail: "Commissioning", patterns: ["commissioning"], mode: "end" },
        { type: "handover_om", detail: "Handover to O&M", patterns: ["handover to matriarch"], mode: "end" },
        { type: "handover_client", detail: "Handover to Client", patterns: ["handover to client"], mode: "end" },
        { type: "practical_completion", detail: "Practical Completion", patterns: ["practical completion"], mode: "end" },
        { type: "pd_handover", detail: "PD Handover", patterns: ["bd handover", "project charter handover"], mode: "end" },
        { type: "construction_start", detail: "Construction Start", patterns: ["site establishment"], mode: "start" },
      ];

      const projectMilestones = new Map<string, UpcomingEvent>();

      for (const task of planTasks) {
        const desc = (task.highLevelProgramme || "").toLowerCase();
        for (const m of milestoneMatchers) {
          const matches = m.patterns.some((p) => desc.includes(p));
          if (!matches) continue;

          // Look-ahead uses the canonical schedule date (actual when present,
          // planned otherwise) so future milestones — whose actuals are still
          // null — are visible on the calendar.
          const dateVal = m.mode === "start"
            ? (task.actualStart || task.startDate || "")
            : (task.actualEnd || task.endDate || "");
          if (!dateVal || !/^\d{4}-\d{2}-\d{2}/.test(dateVal)) continue;
          const dt = dateVal.slice(0, 10);
          if (dt < rangeStart || dt > rangeEnd) continue;

          const key = `${task.projectId}-${m.type}`;
          const existing = projectMilestones.get(key);
          if (!existing ||
            (m.mode === "end" && dt > existing.date) ||
            (m.mode === "start" && dt < existing.date)) {
            projectMilestones.set(key, {
              type: m.type,
              date: dt,
              projectName: task.projectName || "Unnamed",
              projectId: task.projectId || null,
              detail: m.detail,
            });
          }
        }
      }

      events.push(...projectMilestones.values());

      const inflowRows = await db.select({
        projectName: normalizedRevenueLines.projectName,
        projectId: normalizedRevenueLines.projectId,
        expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
        amountExVat: normalizedRevenueLines.amountExVat,
        description: normalizedRevenueLines.description,
        milestoneName: normalizedRevenueLines.milestoneName,
        paidDate: normalizedRevenueLines.paidDate,
        paidDateConfirmed: normalizedRevenueLines.paidDateConfirmed,
        paidDateFontColor: normalizedRevenueLines.paidDateFontColor,
        inBankDate: normalizedRevenueLines.inBankDate,
      }).from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)));

      for (const r of inflowRows) {
        // Per COO rule: only treat as received when in_bank_date is set OR
        // paid_date is confirmed (paidDateConfirmed=true OR black/#000000 font).
        // An unconfirmed (red) paid_date is just a forecast and should remain
        // visible on the look-ahead calendar.
        const inBank = !!r.inBankDate;
        const paidColor = String(r.paidDateFontColor || "").toLowerCase();
        const confirmedPaid =
          !!r.paidDate && (r.paidDateConfirmed === true || paidColor.includes("black") || paidColor.includes("000000"));
        if (inBank || confirmedPaid) continue;
        const dt = (r.expectedPaymentDate || "").slice(0, 10);
        if (dt >= rangeStart && dt <= rangeEnd) {
          events.push({
            type: "payment_in",
            date: dt,
            projectName: r.projectName,
            projectId: r.projectId,
            detail: r.milestoneName || r.description || "Inflow expected",
            amount: r.amountExVat || undefined,
          });
        }
      }

      const outflowRows = await db.select({
        projectName: normalizedCostLines.projectName,
        projectId: normalizedCostLines.projectId,
        invoiceDate: normalizedCostLines.invoiceDate,
        forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
        adminDateOverride: normalizedCostLines.adminDateOverride,
        amountExVat: normalizedCostLines.amountExVat,
        description: normalizedCostLines.description,
        counterpartyName: normalizedCostLines.counterpartyName,
        paidDate: normalizedCostLines.paidDate,
        paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
        paidDateFontColor: normalizedCostLines.paidDateFontColor,
      }).from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)));

      for (const c of outflowRows) {
        // Same confirmation gate as inflows: an unconfirmed (red) paid_date is
        // just a forecast — keep it on the look-ahead calendar. Only skip when
        // payment is confirmed.
        const cPaidColor = String(c.paidDateFontColor || "").toLowerCase();
        const cConfirmedPaid =
          !!c.paidDate && (c.paidDateConfirmed === true || cPaidColor.includes("black") || cPaidColor.includes("000000"));
        if (cConfirmedPaid) continue;
        // Date priority for planning view:
        //   1. admin_date_override — explicit override in the Tracker
        //   2. forecast_payment_date — finance's planned pay date
        //   3. invoice_date — fallback for legacy lines with no forecast set
        // The fallback exists because most cost lines today only have an
        // invoice_date populated; without it the calendar would be empty.
        const dt = ((c.adminDateOverride || c.forecastPaymentDate || c.invoiceDate || "") as string).slice(0, 10);
        if (dt >= rangeStart && dt <= rangeEnd) {
          events.push({
            type: "payment_out",
            date: dt,
            projectName: c.projectName,
            projectId: c.projectId,
            detail: c.counterpartyName || c.description || "Outflow due",
            amount: c.amountExVat || undefined,
          });
        }
      }

      events.sort((a, b) => a.date.localeCompare(b.date));
      res.json({ rangeStart, rangeEnd, events });
    } catch (err: any) {
      console.error("upcoming-events error:", err);
      res.status(500).json({ error: "Failed to load upcoming events" });
    }
  });

  app.get("/api/upcoming-financials", requireAuth, requirePermission("financials", "view"), async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const workDays: string[] = [];
      let d = new Date(today);
      while (workDays.length < 10) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) workDays.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
      const rangeStart = workDays[0];
      const rangeEnd = workDays[workDays.length - 1];

      type FinancialEvent = { type: "inflow" | "outflow"; date: string; projectName: string; projectId: number | null; detail: string; amount: string | null; invoiceNumber?: string | null };
      const events: FinancialEvent[] = [];

      const inflowRows = await db.select({
        projectName: normalizedRevenueLines.projectName,
        projectId: normalizedRevenueLines.projectId,
        expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        amountExVat: normalizedRevenueLines.amountExVat,
        description: normalizedRevenueLines.description,
        milestoneName: normalizedRevenueLines.milestoneName,
        invoiceNumber: normalizedRevenueLines.invoiceNumber,
        paidDate: normalizedRevenueLines.paidDate,
      }).from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)));

      for (const r of inflowRows) {
        if (r.paidDate) continue;
        const dt = (r.expectedPaymentDate || r.invoiceDate || "").slice(0, 10);
        if (!dt || !/^\d{4}-\d{2}-\d{2}/.test(dt)) continue;
        if (dt >= rangeStart && dt <= rangeEnd) {
          events.push({
            type: "inflow",
            date: dt,
            projectName: r.projectName,
            projectId: r.projectId,
            detail: r.milestoneName || r.description || "Inflow expected",
            amount: r.amountExVat || null,
            invoiceNumber: r.invoiceNumber || null,
          });
        }
      }

      const outflowRows = await db.select({
        projectName: normalizedCostLines.projectName,
        projectId: normalizedCostLines.projectId,
        invoiceDate: normalizedCostLines.invoiceDate,
        amountExVat: normalizedCostLines.amountExVat,
        description: normalizedCostLines.description,
        counterpartyName: normalizedCostLines.counterpartyName,
        paidDate: normalizedCostLines.paidDate,
        invoiceNumber: normalizedCostLines.invoiceNumber,
      }).from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)));

      for (const c of outflowRows) {
        if (c.paidDate) continue;
        const dt = (c.invoiceDate || "").slice(0, 10);
        if (!dt || !/^\d{4}-\d{2}-\d{2}/.test(dt)) continue;
        if (dt >= rangeStart && dt <= rangeEnd) {
          events.push({
            type: "outflow",
            date: dt,
            projectName: c.projectName,
            projectId: c.projectId,
            detail: c.counterpartyName || c.description || "Outflow due",
            amount: c.amountExVat || null,
            invoiceNumber: c.invoiceNumber || null,
          });
        }
      }

      events.sort((a, b) => a.date.localeCompare(b.date));

      let totalInflow = 0, totalOutflow = 0;
      for (const ev of events) {
        const amt = Number(ev.amount) || 0;
        if (ev.type === "inflow") totalInflow += amt;
        else totalOutflow += amt;
      }

      res.json({ rangeStart, rangeEnd, events, totalInflow, totalOutflow, netCashflow: totalInflow - totalOutflow });
    } catch (err: any) {
      console.error("upcoming-financials error:", err);
      res.status(500).json({ error: "Failed to load upcoming financials" });
    }
  });
}
