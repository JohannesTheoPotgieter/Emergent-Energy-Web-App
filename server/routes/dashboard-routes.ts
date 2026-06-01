import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth-context";
import { ApiError, badRequest, serverError, sendError } from "../lib/api-error";
import { evaluateRevenueArStatus } from "../lib/finance/revenue-ar-status";
import { computeMarginPct } from "../lib/finance/margin";
import { setFinanceTrustHeaders, buildTrustMeta } from "../lib/finance-trust/envelope";
import { getCanonicalAllCurrentCostLines } from "../services/project-cost-line-read-service";
import { getMergedExpensesAndInflows, resolveInflowEffectiveDates } from "../lib/cashflow-helpers";
import {
  getFinancialSummary,
  type FinancialSummaryPeriod,
} from "../repositories/finance-analysis-repository";
import {
  getDashboardImportHealth,
  getDashboardAttentionItems,
} from "../repositories/dashboard-repository";
import { deriveQualityStatusLabel } from "@shared/quality-governance";
import {
  getProgramDashboardData,
  type ProgramDashboardFilters,
} from "../repositories/program-dashboard-repository";

// SA working-day calculation now lives in the shared server/lib/sa-holidays
// module (was duplicated verbatim across several route files).
import { saWorkingDays } from "../lib/sa-holidays";

export function registerDashboardRoutes(app: Express) {
  void computeMarginPct;
  // ==================== PROGRAM DASHBOARD API ====================

  app.get("/api/program-dashboard", requireAuth, async (req, res) => {
    try {
      const dashUser = req.user;
      const q = req.query as Record<string, string | undefined>;
      const toggle = (name: string) => (q[name] || '').toLowerCase() === 'true';
      const filters: ProgramDashboardFilters = {
        search: q.search,
        portfolio: q.portfolio,
        pm: q.pm,
        pd: q.pd,
        executionPhase: q.executionPhase,
        rag: q.rag,
        exceptionOnly: toggle('exceptionOnly'),
        behindPlanOnly: toggle('behindPlanOnly'),
        inflowRiskOnly: toggle('inflowRiskOnly'),
        outflowRiskOnly: toggle('outflowRiskOnly'),
        engineeringBlockersOnly: toggle('engineeringBlockersOnly'),
        qualityIssuesOnly: toggle('qualityIssuesOnly'),
        pendingApprovalsOnly: toggle('pendingApprovalsOnly'),
        staleImportsOnly: toggle('staleImportsOnly'),
      };
      const result = await getProgramDashboardData({
        user: { id: dashUser?.id || 0, role: dashUser?.role || "", name: dashUser?.name || "" },
        filters,
      });
      const refreshedAt = new Date().toISOString();
      const trustParams = {
        sourceLayer: "canonical" as const,
        canonicalTable:
          "normalized_cost_lines,normalized_revenue_lines,cashflow_points,finance_cos_monthly,finance_revenue_monthly",
        refreshedAt,
        staleAfterSeconds: 300,
        nullCount: result.nullCount,
      };
      setFinanceTrustHeaders(res, trustParams);
      const trust = buildTrustMeta(trustParams);
      res.json({ ...result, trust });
    } catch (error) {
      console.error("Program dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch program dashboard", message: "Failed to fetch program dashboard" });
    }
  });


  app.get("/api/dashboard/high-priority", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, legacyExpenses, legacyRawInflows, legacyRawPlans, allPlanOverrides, allTaskLinks, allOpTasks, inBankOverrides] = await Promise.all([
        storage.getAllProjectInfo(),
        getCanonicalAllCurrentCostLines(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        Promise.resolve([] as any[]),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        Promise.resolve([] as Array<{ overrideValue: string; projectName: string; rowNumber: string }>),
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

      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "normalized_cost_lines,normalized_revenue_lines,project_info",
      });
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
  // GET /api/dashboard — retired: department project-routes handler wins by registration order

  app.get("/api/dashboard/import-health", requireAuth, async (_req, res) => {
    try {
      const health = await getDashboardImportHealth();
      res.json(health);
    } catch (error) {
      console.error("Import health API error:", error);
      res.status(500).json({ error: "Failed to fetch import health" });
    }
  });

  app.get("/api/dashboard/attention-items", requireAuth, async (_req, res) => {
    try {
      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "work_items,qc_warning,financial_edit_requests,project_info",
        staleAfterSeconds: 60,
      });
      const items = await getDashboardAttentionItems();
      const _qualityOpen = items.qualityWarnings.length;
      const _qualityHigh = items.qualityWarnings.filter((w) => w.severity === "high").length;
      const qualityStatus = deriveQualityStatusLabel(_qualityOpen, _qualityHigh);
      res.json({ ...items, qualityStatus });
    } catch (error) {
      console.error("Attention items API error:", error);
      res.status(500).json({ error: "Failed to fetch attention items" });
    }
  });

  app.get("/api/dashboard/financial-summary", requireAuth, async (req, res) => {
    try {
      const periodRaw = String(req.query.period || "ytd");
      const allowed: FinancialSummaryPeriod[] = ["ytd", "current_fy", "this_month", "last_month", "custom"];
      const period = (allowed as string[]).includes(periodRaw)
        ? (periodRaw as FinancialSummaryPeriod)
        : "ytd";
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;

      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "normalized_cost_lines,normalized_revenue_lines,opex_budget_monthly",
        staleAfterSeconds: 60,
      });

      const summary = await getFinancialSummary({ period, from, to });
      res.json(summary);
    } catch (error: unknown) {
      // EE-QA-011 residual — never leak raw err.message / err.stack in a
      // JSON response. ApiError instances are passed through (the global
      // handler already sanitises them); other errors become a generic
      // 500 with a sanitised message.
      if (error instanceof ApiError) {
        return sendError(res, error);
      }
      const status = (error as { status?: number } | null)?.status === 400 ? 400 : 500;
      if (status === 400) {
        return sendError(res, badRequest("Invalid financial summary parameters"));
      }
      console.error("Financial summary API error:", error);
      return sendError(res, serverError("Failed to fetch financial summary"));
    }
  });

  app.get("/api/dashboard/my-work", requireAuth, async (req, res) => {
    try {
      const role = String(req.user?.role || "USER").toUpperCase();
      const roleView =
        role.includes("FINANCE") || role === "CFO" ? "Finance focus" :
        role.includes("ENGINEER") ? "Engineering focus" :
        role.includes("ADMIN") ? "Admin focus" :
        role.includes("PROJECT") || role.includes("PM") ? "PM focus" : "General";

      // Real per-user task / approval / mention queries are not yet wired up
      // (see T1.x audit, defect 1). Until they are, return empty arrays so
      // the UI shows an honest empty state rather than fabricated rows.
      res.json({
        overdueTasks: [],
        dueTodayTasks: [],
        upcomingTasks: [],
        pendingApprovals: [],
        recentMentions: [],
        assignedProjects: [],
        roleView,
      });
    } catch (error) {
      console.error("My work dashboard API error:", error);
      res.status(500).json({ error: "Failed to fetch my work" });
    }
  });
}
