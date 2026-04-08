/**
 * Overview Route — Extracted from server/routes.ts (Phase 8)
 *
 * 1 handler:
 *   GET /api/overview — program-level financial summary dashboard
 */

import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { normalizedCostLines, normalizedRevenueLines, workItems, projectInfo } from "@shared/schema";
import { requireAuth } from "../auth-context";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import { mapCostToExpenseInput } from "../lib/data-merge";
import { resolveInflowEffectiveDates } from "../lib/cashflow-helpers";
import { isWorkItemsEnabled } from "../work-items-adapter";

export function registerOverviewExtractedRoutes(app: Express): void {

  // ==================== OVERVIEW API ====================

  app.get("/api/overview", requireAuth, async (req, res) => {
    try {
      const useCanonicalOv = await isWorkItemsEnabled();
      const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, allTaskLinks, allOpTasks, allNormCostsOv, allNormRevOv, allNormPlansOv] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getLatestRefresh(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
        db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
        useCanonicalOv
          ? (async () => {
              const [wiRows, piRows] = await Promise.all([
                db.select().from(workItems).where(isNull(workItems.deletedAt)),
                db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
              ]);
              const piNameMap = new Map(piRows.map((p: { id: number; projectName: string }) => [p.id, p.projectName]));
              return wiRows.map((wi: any) => ({
                id: wi.id,
                projectId: wi.projectId,
                projectName: (wi.projectId ? piNameMap.get(wi.projectId) : null) || "",
                taskName: wi.title,
                taskNo: wi.wbsCode,
                phase: wi.type,
                startDate: wi.startDate,
                endDate: wi.endDate,
                durationDays: wi.duration,
                actualStartDate: wi.actualStart || wi.startDate,
                actualEndDate: wi.actualEnd || wi.endDate,
                actualDurationDays: wi.actualDuration || wi.duration,
                owner: null,
                assigneeUserId: wi.ownerUserId,
                status: wi.status,
                pctComplete: wi.percentComplete,
                expectedPctComplete: null,
                comment: wi.description,
                isMilestone: wi.type === "milestone",
                parentTaskNo: null,
                indentLevel: 0,
                sourceSheet: null,
                sourceRow: null,
                importRunId: 0,
                scheduledDate: null,
                scheduledStartTime: null,
                scheduledEndTime: null,
              }));
            })()
          : (async () => {
              const [wiRows, piRows] = await Promise.all([
                db.select().from(workItems).where(and(eq(workItems.workstream, 'PM' as any), eq(workItems.source, 'SMART_IMPORT' as any), isNull(workItems.deletedAt))),
                db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
              ]);
              const piNameMap = new Map(piRows.map((p: { id: number; projectName: string }) => [p.id, p.projectName]));
              return wiRows.map((wi: any) => ({
                id: wi.id,
                projectId: wi.projectId,
                projectName: (wi.projectId ? piNameMap.get(wi.projectId) : null) || "",
                taskName: wi.title,
                taskNo: wi.wbsCode,
                phase: wi.type,
                startDate: wi.startDate,
                endDate: wi.endDate,
                durationDays: wi.duration,
                actualStartDate: wi.actualStart || wi.startDate,
                actualEndDate: wi.actualEnd || wi.endDate,
                actualDurationDays: wi.actualDuration || wi.duration,
                owner: null,
                assigneeUserId: wi.ownerUserId,
                status: wi.status,
                pctComplete: wi.percentComplete,
                expectedPctComplete: null,
                comment: wi.description,
                isMilestone: wi.type === "milestone",
                parentTaskNo: null,
                indentLevel: 0,
                sourceSheet: null,
                sourceRow: null,
                importRunId: 0,
                scheduledDate: null,
                scheduledStartTime: null,
                scheduledEndTime: null,
              }));
            })(),
      ]);

      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

      const today = new Date().toISOString().split("T")[0];

      const piNamesOvEarly = new Set(allProjectInfo.map(i => i.projectName));
      const piNormMapOvEarly = new Map<string, string>();
      for (const n of piNamesOvEarly) {
        piNormMapOvEarly.set(n.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim(), n);
      }
      function resolveOvName(name: string): string {
        if (piNamesOvEarly.has(name)) return name;
        for (const v of [name.replace(/ /g, "_") + "_Tracker", name + "_Tracker", name.replace(/ /g, "_")]) {
          if (piNamesOvEarly.has(v)) return v;
        }
        const nk = name.replace(/[_ ]/g, " ").toLowerCase().trim();
        const fm = piNormMapOvEarly.get(nk);
        if (fm) return fm;
        for (const [pn, pi] of piNormMapOvEarly) {
          if (pn.endsWith(nk) || nk.endsWith(pn)) return pi;
        }
        return name;
      }
      const oldExpenseProjects = new Set(allExpenses.map(e => resolveOvName(e.projectName)));
      const oldInflowProjects = new Set(allInflows.map(i => resolveOvName(i.projectName)));

      // total_program_budget = SUM(project_info.contract_value)
      let totalProgramBudget = 0;
      for (const info of allProjectInfo) {
        if (info.contractValue) {
          totalProgramBudget += parseFloat(info.contractValue) || 0;
        }
      }
      
      // Fallback to sum of inflows if no contract values
      if (totalProgramBudget === 0) {
        for (const inflow of allInflows) {
          if (inflow.milestoneAmount) {
            totalProgramBudget += parseFloat(inflow.milestoneAmount) || 0;
          }
        }
        if (totalProgramBudget === 0) {
          for (const rev of allNormRevOv) {
            if (rev.amountExVat) totalProgramBudget += parseFloat(rev.amountExVat) || 0;
          }
        }
      }

      // actual_spend_paid = SUM(expense_actual_total where classifyExpenseState === 'Paid')
      let actualSpendPaid = 0;
      for (const expense of allExpenses) {
        if (expense.expenseActualTotal) {
          const state = classifyExpenseState(expense as any);
          if (state === 'Paid') {
            actualSpendPaid += parseFloat(expense.expenseActualTotal) || 0;
          }
        }
      }
      for (const cost of allNormCostsOv) {
        if (oldExpenseProjects.has(resolveOvName(cost.projectName))) continue;
        if (cost.amountExVat) {
          const state = classifyExpenseState(mapCostToExpenseInput(cost));
          if (state === 'Paid') {
            actualSpendPaid += parseFloat(cost.amountExVat) || 0;
          }
        }
      }

      // revenue_realised = SUM(milestone_amount where in-bank: manualInBank || (hasPaymentReceived && hasInvoice))
      let revenueRealised = 0;
      for (const inflow of allInflows) {
        if (inflow.milestoneAmount) {
          const manualInBank = (inflow as any).inBank === 1 || (inflow as any).inBank === '1' || (inflow as any).inBank === true;
          const hasInvoice = !!(inflow.milestoneInvoiceNumber && String(inflow.milestoneInvoiceNumber).trim());
          const hasPaymentReceived = !!(inflow.paymentReceivedDate && String(inflow.paymentReceivedDate).trim() && inflow.paymentReceivedDate !== '-');
          const isInBank = manualInBank || (hasPaymentReceived && hasInvoice);
          if (isInBank) {
            revenueRealised += parseFloat(inflow.milestoneAmount) || 0;
          }
        }
      }
      for (const rev of allNormRevOv) {
        if (oldInflowProjects.has(resolveOvName(rev.projectName))) continue;
        if (rev.amountExVat) {
          const manualInBank = (rev as any).inBank === 1 || (rev as any).inBank === '1' || (rev as any).inBank === true;
          const hasInvoice = !!(rev.invoiceNumber && String(rev.invoiceNumber).trim());
          const hasPaymentReceived = !!(rev.paidDate && String(rev.paidDate).trim() && rev.paidDate !== '-');
          const isInBank = manualInBank || (hasPaymentReceived && hasInvoice);
          if (isInBank) {
            revenueRealised += parseFloat(rev.amountExVat) || 0;
          }
        }
      }

      const uniqueProjects = new Set<string>();
      for (const info of allProjectInfo) uniqueProjects.add(info.projectName);
      for (const expense of allExpenses) uniqueProjects.add(resolveOvName(expense.projectName));
      for (const inflow of allInflows) uniqueProjects.add(resolveOvName(inflow.projectName));
      for (const plan of allPlans) uniqueProjects.add(resolveOvName(plan.projectName));
      for (const c of allNormCostsOv) uniqueProjects.add(resolveOvName(c.projectName));
      for (const r of allNormRevOv) uniqueProjects.add(resolveOvName(r.projectName));
      for (const p of allNormPlansOv) uniqueProjects.add(resolveOvName(p.projectName));

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
}
