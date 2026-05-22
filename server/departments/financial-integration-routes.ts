// Error breakdown: TS7006 implicit-any: 17, TS2345 query/param types: 14, other: 9
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, requireAdmin } from "./shared-middleware";
import { storage } from "../storage";
import { createNotification } from "../services/notification-service";
import { paramStr, parseIntParam } from "../lib/req-params";
import { getCanonicalProjectCostLinesByName } from "../services/project-cost-line-read-service";
import { FinancialIntegrationRepository } from "../repositories/financial-integration-repository";
import { ProjectInfoRepository } from "../repositories/project-info-repository";
import { WorkManagementRepository } from "../repositories/work-management-repository";
import { UsersRepository } from "../repositories/users-repository";

const financialIntegrationRepository = new FinancialIntegrationRepository();
const projectInfoRepository = new ProjectInfoRepository();
const workManagementRepository = new WorkManagementRepository();
const usersRepository = new UsersRepository();

const router = Router();

const FINANCIAL_APPROVER_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER"];
const FINANCIAL_EDITOR_ROLES = [...FINANCIAL_APPROVER_ROLES, "PROJECT_MANAGER_SITE"];

function isApproverRole(role: string | undefined): boolean {
  return !!role && FINANCIAL_APPROVER_ROLES.includes(role);
}

function isEditorRole(role: string | undefined): boolean {
  return !!role && FINANCIAL_EDITOR_ROLES.includes(role);
}

function requireFinancialEditor(req: Request, res: Response, next: NextFunction) {
  if (isEditorRole(req.user?.role)) return next();
  res.status(403).json({ error: "forbidden", message: "Financial editor access required" });
}

function requireFinancialApprover(req: Request, res: Response, next: NextFunction) {
  if (isApproverRole(req.user?.role)) return next();
  res.status(403).json({ error: "forbidden", message: "Financial approver access required" });
}

async function detectCriticalPathImpact(projectName: string, taskIds: number[]): Promise<boolean> {
  if (taskIds.length === 0) return false;
  try {
    const projectId = await projectInfoRepository.findIdByProjectName(projectName);
    if (projectId === null) return false;
    const tasks = await workManagementRepository.listByProjectIdNonDeleted(projectId);
    const relevantTasks = tasks.filter((t: any) => taskIds.includes(t.sourceRow || t.id));
    for (const task of relevantTasks) {
      if ((task as any).isCriticalPath || (task as any).is_critical_path) return true;
      const pct = Number(task.percentComplete || 0);
      if (pct < 1 && task.endDate) {
        const endDate = new Date(task.endDate);
        const now = new Date();
        if (endDate < now) return true;
      }
    }
  } catch (err) {
    console.warn("[fin-integration] Critical path detection failed:", err);
  }
  return false;
}

async function detectRevenueImpact(projectName: string, taskIds: number[]): Promise<boolean> {
  if (taskIds.length === 0) return false;
  try {
    const links = await financialIntegrationRepository.listMilestoneTaskLinksByProject(projectName);
    const linkedTaskIds = links.map((l: any) => l.taskId);
    for (const tid of taskIds) {
      if (linkedTaskIds.includes(tid) || linkedTaskIds.includes(-tid)) return true;
    }
  } catch (err) {
    console.warn("[fin-integration] Revenue impact detection failed:", err);
  }
  return false;
}

async function detectExpenditureImpact(projectName: string, taskIds: number[]): Promise<boolean> {
  if (taskIds.length === 0) return false;
  try {
    const links = await financialIntegrationRepository.listExpenseTaskLinksByProject(projectName);
    const linkedTaskIds = links.map((l: any) => l.taskId);
    for (const tid of taskIds) {
      if (linkedTaskIds.includes(tid) || linkedTaskIds.includes(-tid)) return true;
    }
  } catch (err) {
    console.warn("[fin-integration] Expenditure impact detection failed:", err);
  }
  return false;
}

async function sendFinancialWarningNotifications(
  projectName: string,
  editSummary: string,
  flags: { isCriticalPath: boolean; affectsRevenue: boolean; affectsExpenditure: boolean; affectsQuality: boolean },
  requestedByUserId: number,
  requestId: number
) {
  try {
    const tags: string[] = [];
    if (flags.isCriticalPath) tags.push("CRITICAL PATH");
    if (flags.affectsRevenue) tags.push("REVENUE IMPACT");
    if (flags.affectsExpenditure) tags.push("EXPENDITURE IMPACT");
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";

    const approvers = await usersRepository.listByRoles(FINANCIAL_APPROVER_ROLES);
    for (const approver of approvers) {
      if (approver.id === requestedByUserId) continue;
      await createNotification({
        recipientUserId: approver.id,
        eventType: "financial.edit_request_pending",
        title: `Financial edit request: ${projectName}${tagStr}`,
        body: editSummary,
        projectName,
        relatedEntityType: "financial_edit_request",
        relatedEntityId: requestId,
      });
    }
  } catch (err) {
    console.error("[fin-integration] Failed to send financial warning notifications:", err);
  }
}

async function sendIntegrationWarningNotifications(
  projectName: string,
  warningType: string,
  title: string,
  body: string,
  linkedTaskId?: number
) {
  try {
    const approvers = await usersRepository.listByRoles(FINANCIAL_APPROVER_ROLES);
    for (const approver of approvers) {
      await createNotification({
        recipientUserId: approver.id,
        eventType: `financial.integration_warning.${warningType}`,
        title,
        body,
        projectName,
        linkedTaskId,
        relatedEntityType: "financial_integration_warning",
      });
    }
  } catch (err) {
    console.error("[fin-integration] Failed to send integration warning notifications:", err);
  }
}

router.post("/api/financial-edit-requests", requireAuth, requireFinancialEditor, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const { projectName, editType, editTarget, editPayload, editSummary, taskIds } = req.body;

    if (!projectName || !editType || !editTarget || !editPayload || !editSummary) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const relevantTaskIds = Array.isArray(taskIds) ? taskIds : [];

    const isCriticalPath = await detectCriticalPathImpact(projectName, relevantTaskIds);
    const affectsRevenue = await detectRevenueImpact(projectName, relevantTaskIds);
    const affectsExpenditure = await detectExpenditureImpact(projectName, relevantTaskIds);
    const affectsQuality = false;

    if (isApproverRole(userRole)) {
      const saved = await financialIntegrationRepository.createEditRequest({
        projectName,
        requestedByUserId: userId,
        editType,
        editTarget,
        editPayload: typeof editPayload === "string" ? editPayload : JSON.stringify(editPayload),
        editSummary,
        isCriticalPath,
        affectsRevenue,
        affectsExpenditure,
        affectsQuality,
        status: "auto_approved",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      });

      if (isCriticalPath || affectsRevenue || affectsExpenditure) {
        await sendIntegrationWarningNotifications(
          projectName,
          isCriticalPath ? "critical_path" : "financial_impact",
          `Financial Edit Applied: ${projectName}`,
          `An authorized edit was applied. ${editSummary}${isCriticalPath ? " [CRITICAL PATH]" : ""}${affectsRevenue ? " [REVENUE IMPACT]" : ""}${affectsExpenditure ? " [EXPENDITURE IMPACT]" : ""}`,
        );
      }

      return res.json({ status: "auto_approved", request: saved, message: "Edit applied directly (authorized role)" });
    }

    const saved = await financialIntegrationRepository.createEditRequest({
      projectName,
      requestedByUserId: userId,
      editType,
      editTarget,
      editPayload: typeof editPayload === "string" ? editPayload : JSON.stringify(editPayload),
      editSummary,
      isCriticalPath,
      affectsRevenue,
      affectsExpenditure,
      affectsQuality,
      status: "pending",
    });

    await sendFinancialWarningNotifications(
      projectName,
      editSummary,
      { isCriticalPath, affectsRevenue, affectsExpenditure, affectsQuality },
      userId,
      saved.id
    );

    res.json({ status: "pending_approval", request: saved, message: "Your edit has been submitted for approval." });
  } catch (error: any) {
    console.error("[fin-edit-request] Error:", error);
    res.status(500).json({ error: "Failed to create edit request" });
  }
});

router.get("/api/financial-edit-requests", requireAuth, async (req: Request, res: Response) => {
  try {
    const { projectName, status: filterStatus } = req.query;
    const userRole = req.user!.role;
    const userId = req.user!.id;

    const results = await financialIntegrationRepository.listEditRequests({
      projectName: typeof projectName === "string" ? projectName : undefined,
      status: typeof filterStatus === "string" ? filterStatus : undefined,
      requestedByUserId: isApproverRole(userRole) ? undefined : userId,
    });

    res.json(results.map((r: any) => ({
      ...r.request,
      requestedByName: r.requestedBy?.name || "Unknown",
      requestedByRole: r.requestedBy?.role || "",
    })));
  } catch (error: any) {
    console.error("[fin-edit-request] List error:", error);
    res.status(500).json({ error: "Failed to fetch edit requests" });
  }
});

router.get("/api/financial-edit-requests/pending-count", requireAuth, async (req: Request, res: Response) => {
  try {
    const userRole = req.user!.role;
    if (!isApproverRole(userRole)) {
      return res.json({ count: 0 });
    }

    const count = await financialIntegrationRepository.countEditRequestsByStatus("pending");
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: "Failed to get count" });
  }
});

router.post("/api/financial-edit-requests/:id/approve", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const requestId = parseIntParam(req.params.id);
    const userId = req.user!.id;
    const { comment } = req.body;

    const existing = await financialIntegrationRepository.getEditRequestById(requestId);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Request is not pending" });

    const updated = await financialIntegrationRepository.updateEditRequest(requestId, {
      status: "approved",
      reviewedByUserId: userId,
      reviewComment: comment || null,
      reviewedAt: new Date(),
    });

    // Apply the overrides now that they've been approved
    if (existing.editType === "expenditure_override") {
      try {
        const payload = typeof existing.editPayload === "string" ? JSON.parse(existing.editPayload) : existing.editPayload;
        const overrides = payload.overrides;
        if (Array.isArray(overrides)) {
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
            supplierName: "supplierName",
          };

          const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
          for (const pn of projectNames) {
            const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
            const { rows: expenses } = await getCanonicalProjectCostLinesByName(pn as string);
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
              if (ov.fieldName === 'expenseInvoicedDate' && !effectiveValue) {
                fields.invoiceDateConfirmed = false;
              }
              if (ov.fieldName === 'expensePaymentDate' && !effectiveValue) {
                fields.paymentDateConfirmed = false;
              }
            }

            for (const [expenseId, fields] of rowGroups.entries()) {
              if (Object.keys(fields).length > 0) {
                await storage.updateProgramExpenseFields(expenseId, fields);
              }
            }
          }
          console.log(`[fin-edit-request] Applied ${overrides.length} expenditure override(s) after approval of request #${requestId}`);
        }
      } catch (applyErr: any) {
        console.error(`[fin-edit-request] Failed to apply overrides for request #${requestId}:`, applyErr);
        // Mark as approved but flag the application failure
        await financialIntegrationRepository.appendReviewCommentOnApprovalFailure(
          requestId,
          `${comment || ""} [WARNING: Overrides approved but failed to apply. Review server logs for request #${requestId}.]`.trim(),
        );
        return res.status(500).json({
          error: "Approved but failed to apply overrides",
          message: "Overrides were approved, but the apply step failed. Review server logs for the request ID.",
        });
      }
    }

    res.json({ message: "Edit request approved and applied", request: updated });
  } catch (error: any) {
    console.error("[fin-edit-request] Approve error:", error);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

router.post("/api/financial-edit-requests/:id/reject", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const requestId = parseIntParam(req.params.id);
    const userId = req.user!.id;
    const { comment } = req.body;

    if (!comment || typeof comment !== "string" || comment.trim().length < 3) {
      return res.status(400).json({ error: "Rejection requires a comment (min 3 characters)" });
    }

    const existing = await financialIntegrationRepository.getEditRequestById(requestId);
    if (!existing) return res.status(404).json({ error: "Request not found" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Request is not pending" });

    const updated = await financialIntegrationRepository.updateEditRequest(requestId, {
      status: "rejected",
      reviewedByUserId: userId,
      reviewComment: comment.trim(),
      reviewedAt: new Date(),
    });

    // Notify the requester that their edit was rejected
    try {
      await createNotification({
        recipientUserId: existing.requestedByUserId,
        eventType: "financial.edit_request_rejected",
        title: `Financial edit rejected: ${existing.projectName}`,
        body: `Your edit request was rejected. Reason: ${comment.trim()}`,
        projectName: existing.projectName,
        relatedEntityType: "financial_edit_request",
        relatedEntityId: requestId,
      });
    } catch (err) {
      console.error("[fin-integration] Failed to send rejection notification:", err);
    }

    res.json({ message: "Edit request rejected", request: updated });
  } catch (error: any) {
    console.error("[fin-edit-request] Reject error:", error);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

router.get("/api/financial-integration/warnings/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const warnings: { type: string; severity: string; message: string; details?: any }[] = [];

    const { rows: expenses } = await getCanonicalProjectCostLinesByName(projectName);
    const inflows = await storage.getProgramInflowsByProject(projectName);
    const projectId = await projectInfoRepository.findIdByProjectName(projectName);
    const planTasks = projectId !== null
      ? await workManagementRepository.listByProjectIdNonDeleted(projectId)
      : [];
    const expLinks = await financialIntegrationRepository.listExpenseTaskLinksByProject(projectName);
    const revLinks = await financialIntegrationRepository.listMilestoneTaskLinksByProject(projectName);

    const today = new Date().toISOString().split("T")[0];

    const totalBudget = expenses.reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
    const totalActual = expenses.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
    if (totalBudget > 0 && totalActual > totalBudget) {
      const overPct = (((totalActual - totalBudget) / totalBudget) * 100).toFixed(1);
      warnings.push({
        type: "budget_overrun",
        severity: Number(overPct) > 10 ? "critical" : "warning",
        message: `Expenditure exceeds budget by R${((totalActual - totalBudget) / 1000).toFixed(0)}k (${overPct}%)`,
        details: { totalBudget, totalActual, overrunPercent: Number(overPct) },
      });
    }

    // CANONICAL Revenue Recognition (POC) — sum of recognition amounts on
    // cost lines for this project. Falls back to milestone billing total when
    // POC is unavailable (no costed revenue captured yet).
    const pocRevenueTotal = expenses.reduce(
      (s: number, e: any) =>
        s + (e.rowType === 'item' && !e.noRevenueLinked
          ? Number(e.revenueRecognitionAmount) || 0
          : 0),
      0,
    );
    const milestoneRevenueTotal = inflows.reduce(
      (s: number, r: any) => s + (Number(r.milestoneAmount) || 0),
      0,
    );
    const totalRevenue = pocRevenueTotal > 0 ? pocRevenueTotal : milestoneRevenueTotal;
    if (totalRevenue > 0 && totalActual > totalRevenue) {
      warnings.push({
        type: "cos_exceeds_revenue",
        severity: "critical",
        message: `COS (R${(totalActual / 1000).toFixed(0)}k) exceeds total revenue (R${(totalRevenue / 1000).toFixed(0)}k)`,
        details: { totalActual, totalRevenue, revenueMethod: pocRevenueTotal > 0 ? "POC" : "milestone_fallback" },
      });
    }

    const unlinkedExpenses = expenses.filter((e: any) => {
      const amount = Number(e.expenseActualTotal) || 0;
      if (amount === 0) return false;
      return !expLinks.some((l: any) => l.expenseId === e.id);
    });
    if (unlinkedExpenses.length > 0) {
      const totalUnlinked = unlinkedExpenses.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
      warnings.push({
        type: "unlinked_expenses",
        severity: "info",
        message: `${unlinkedExpenses.length} expense line(s) not linked to plan tasks (R${(totalUnlinked / 1000).toFixed(0)}k)`,
        details: { count: unlinkedExpenses.length, totalAmount: totalUnlinked },
      });
    }

    const unlinkedMilestones = inflows.filter((r: any) => {
      const amount = Number(r.milestoneAmount) || 0;
      if (amount === 0) return false;
      return !revLinks.some((l: any) => l.milestoneRowNumber === r.rowNumber);
    });
    if (unlinkedMilestones.length > 0) {
      const totalUnlinked = unlinkedMilestones.reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
      warnings.push({
        type: "unlinked_milestones",
        severity: "info",
        message: `${unlinkedMilestones.length} revenue milestone(s) not linked to plan tasks (R${(totalUnlinked / 1000).toFixed(0)}k)`,
        details: { count: unlinkedMilestones.length, totalAmount: totalUnlinked },
      });
    }

    for (const link of revLinks) {
      const milestone = inflows.find((r: any) => r.rowNumber === link.milestoneRowNumber);
      if (!milestone) continue;
      const taskId = Math.abs(link.taskId);
      const task = planTasks.find((t: any) => (t.sourceRow || t.id) === taskId);
      if (!task) continue;
      const endDate = task.endDate;
      if (endDate && endDate < today) {
        const pct = Number(task.percentComplete || 0);
        if (pct < 1 && !milestone.paymentReceivedDate) {
          warnings.push({
            type: "revenue_at_risk",
            severity: "warning",
            message: `Revenue milestone "${milestone.milestoneName || "Unnamed"}" linked to overdue task "${task.title || "Task"}"`,
            details: { milestoneId: milestone.id, taskRowNumber: task.sourceRow || task.id, taskEndDate: endDate },
          });
        }
      }
    }

    for (const link of expLinks) {
      const expense = expenses.find((e: any) => e.id === link.expenseId);
      if (!expense) continue;
      const taskId = Math.abs(link.taskId);
      const task = planTasks.find((t: any) => (t.sourceRow || t.id) === taskId);
      if (!task) continue;
      const budgetAmt = Number((expense as any).budgetTotal) || 0;
      const actualAmt = Number((expense as any).expenseActualTotal) || 0;
      if (budgetAmt > 0 && actualAmt > budgetAmt * 1.15) {
        warnings.push({
          type: "expense_over_budget",
          severity: "warning",
          message: `Expense "${(expense as any).expenseLineItem || (expense as any).expenseCategory}" exceeds budget by ${(((actualAmt - budgetAmt) / budgetAmt) * 100).toFixed(0)}%`,
          details: { expenseId: expense.id, budget: budgetAmt, actual: actualAmt },
        });
      }
    }

    const overdueTasks = planTasks.filter((t: any) => {
      const pct = Number(t.percentComplete || 0);
      return t.endDate && t.endDate < today && pct < 1;
    });
    const criticalOverdue = overdueTasks.filter((t: any) => (t as any).isCriticalPath);
    if (criticalOverdue.length > 0) {
      warnings.push({
        type: "critical_path_delay",
        severity: "critical",
        message: `${criticalOverdue.length} critical path task(s) overdue — may delay handover`,
        details: { tasks: criticalOverdue.map((t: any) => ({ name: t.title, endDate: t.endDate })) },
      });
    }

    const pendingEditsCount = await financialIntegrationRepository.countPendingEditRequestsForProject(projectName);
    if (pendingEditsCount > 0) {
      warnings.push({
        type: "pending_edits",
        severity: "info",
        message: `${pendingEditsCount} edit request(s) pending approval`,
        details: { count: pendingEditsCount },
      });
    }

    warnings.sort((a, b) => {
      const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });

    res.json({ warnings, projectName });
  } catch (error: any) {
    console.error("[fin-integration] Warnings error:", error);
    res.status(500).json({ error: "Failed to fetch integration warnings" });
  }
});

router.get("/api/financial-integration/sync-status/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = paramStr(req.params.projectName);

    const { rows: expenses } = await getCanonicalProjectCostLinesByName(projectName);
    const inflows = await storage.getProgramInflowsByProject(projectName);
    const projectIdSync = await projectInfoRepository.findIdByProjectName(projectName);
    const planTasks = projectIdSync !== null
      ? await workManagementRepository.listByProjectIdNonDeleted(projectIdSync)
      : [];
    const expLinks = await financialIntegrationRepository.listExpenseTaskLinksByProject(projectName);
    const revLinks = await financialIntegrationRepository.listMilestoneTaskLinksByProject(projectName);

    const totalExpenses = expenses.length;
    const linkedExpenses = expenses.filter((e: any) => expLinks.some((l: any) => l.expenseId === e.id)).length;
    const totalMilestones = inflows.filter((r: any) => Number(r.milestoneAmount) > 0).length;
    const linkedMilestones = inflows.filter((r: any) => revLinks.some((l: any) => l.milestoneRowNumber === r.rowNumber)).length;
    const totalTasks = planTasks.length;

    const expLinkPct = totalExpenses > 0 ? Math.round((linkedExpenses / totalExpenses) * 100) : 0;
    const revLinkPct = totalMilestones > 0 ? Math.round((linkedMilestones / totalMilestones) * 100) : 0;

    const overallSync = totalExpenses + totalMilestones > 0
      ? Math.round(((linkedExpenses + linkedMilestones) / (totalExpenses + totalMilestones)) * 100)
      : 0;

    res.json({
      projectName,
      plan: { totalTasks },
      expenditure: { total: totalExpenses, linked: linkedExpenses, linkPercent: expLinkPct },
      revenue: { total: totalMilestones, linked: linkedMilestones, linkPercent: revLinkPct },
      overallSyncPercent: overallSync,
      syncStatus: overallSync >= 80 ? "good" : overallSync >= 50 ? "partial" : "low",
    });
  } catch (error: any) {
    console.error("[fin-integration] Sync status error:", error);
    res.status(500).json({ error: "Failed to fetch sync status" });
  }
});

router.get("/api/financial-integration/role-access", requireAuth, async (req: Request, res: Response) => {
  const role = req.user?.role || "";
  res.json({
    canEditDirectly: isApproverRole(role),
    canSubmitForApproval: isEditorRole(role) && !isApproverRole(role),
    canApprove: isApproverRole(role),
    canViewRequests: isEditorRole(role),
    role,
  });
});

router.get("/api/financial-integration/rules/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const rules = await financialIntegrationRepository.listRulesForProject(projectName);

    res.json(rules.map((r) => ({
      ...r.rule,
      createdByName: r.createdBy?.name || "Unknown",
    })));
  } catch (error: any) {
    console.error("[fin-rules] List error:", error);
    res.status(500).json({ error: "Failed to fetch rules" });
  }
});

router.post("/api/financial-integration/rules", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { projectName, ruleType, ruleConfig } = req.body;

    if (!projectName || !ruleType || !ruleConfig) {
      return res.status(400).json({ error: "projectName, ruleType, and ruleConfig are required" });
    }

    const validRuleTypes = [
      "budget_threshold",
      "revenue_milestone_linking",
      "expenditure_auto_flag",
      "critical_path_protection",
      "approval_bypass",
      "variance_alert_threshold",
    ];
    if (!validRuleTypes.includes(ruleType)) {
      return res.status(400).json({ error: `Invalid rule type. Must be one of: ${validRuleTypes.join(", ")}` });
    }

    const saved = await financialIntegrationRepository.createRule({
      projectName,
      ruleType,
      ruleConfig: typeof ruleConfig === "string" ? ruleConfig : JSON.stringify(ruleConfig),
      isActive: true,
      createdByUserId: userId,
    });

    res.json(saved);
  } catch (error: any) {
    console.error("[fin-rules] Create error:", error);
    res.status(500).json({ error: "Failed to create rule" });
  }
});

router.patch("/api/financial-integration/rules/:ruleId", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const ruleId = parseIntParam(req.params.ruleId);
    const { ruleConfig, isActive } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (ruleConfig !== undefined) {
      updates.ruleConfig = typeof ruleConfig === "string" ? ruleConfig : JSON.stringify(ruleConfig);
    }
    if (isActive !== undefined) {
      updates.isActive = isActive;
    }

    const updated = await financialIntegrationRepository.updateRule(ruleId, updates);

    if (!updated) return res.status(404).json({ error: "Rule not found" });
    res.json(updated);
  } catch (error: any) {
    console.error("[fin-rules] Update error:", error);
    res.status(500).json({ error: "Failed to update rule" });
  }
});

router.delete("/api/financial-integration/rules/:ruleId", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const ruleId = parseIntParam(req.params.ruleId);
    const deleted = await financialIntegrationRepository.deleteRule(ruleId);

    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[fin-rules] Delete error:", error);
    res.status(500).json({ error: "Failed to delete rule" });
  }
});

router.get("/api/financial-integration/suggested-rules/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const suggestions: {
      id: string;
      ruleType: string;
      ruleConfig: string;
      title: string;
      description: string;
      severity: "critical" | "warning" | "info";
      reason: string;
    }[] = [];

    const { rows: expenses } = await getCanonicalProjectCostLinesByName(projectName);
    const inflows = await storage.getProgramInflowsByProject(projectName);
    const planTasks = await storage.getProjectPlansByProject(projectName);
    const revSummary = await storage.getProjectRevenueSummary(projectName);

    const existingRules = await financialIntegrationRepository.listActiveRulesForProject(projectName);

    const existingRuleTypes = new Set(existingRules.map((r) => r.ruleType));

    const expLinks = await financialIntegrationRepository.listExpenseTaskLinksByProject(projectName);
    const revLinks = await financialIntegrationRepository.listMilestoneTaskLinksByProject(projectName);

    const totalBudget = expenses.reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
    const totalActual = expenses.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
    if (totalBudget > 0) {
      const utilPct = Math.round((totalActual / totalBudget) * 100);
      if (utilPct > 80 && !existingRuleTypes.has("budget_threshold")) {
        suggestions.push({
          id: "suggest-budget-threshold",
          ruleType: "budget_threshold",
          ruleConfig: "90%",
          title: "Budget Threshold Alert",
          description: "Get alerted when spending reaches 90% of budget",
          severity: "warning",
          reason: `Current spend is at ${utilPct}% of budget`,
        });
      }
    }

    const expensesWithAmount = expenses.filter((e: any) => (Number(e.expenseActualTotal) || 0) > 0);
    const unlinkedExpenses = expensesWithAmount.filter((e: any) => !expLinks.some((l: any) => l.expenseId === e.id));
    if (expensesWithAmount.length > 0) {
      const unlinkedPct = Math.round((unlinkedExpenses.length / expensesWithAmount.length) * 100);
      if (unlinkedPct > 50) {
        suggestions.push({
          id: "suggest-auto-linking",
          ruleType: "expenditure_auto_flag",
          ruleConfig: JSON.stringify({ autoLink: true, threshold: "50%" }),
          title: "Auto-Link Expenses to Plan Tasks",
          description: "Automatically suggest linking expenses to related plan tasks based on date and category matching",
          severity: "info",
          reason: `${unlinkedPct}% of expenses (${unlinkedExpenses.length} of ${expensesWithAmount.length}) are not linked to plan tasks`,
        });
      }
    }

    const milestonesWithAmount = inflows.filter((r: any) => (Number(r.milestoneAmount) || 0) > 0);
    const unlinkedMilestones = milestonesWithAmount.filter((r: any) => !revLinks.some((l: any) => l.milestoneRowNumber === r.rowNumber));
    if (unlinkedMilestones.length > 0 && !existingRuleTypes.has("revenue_milestone_linking")) {
      suggestions.push({
        id: "suggest-revenue-milestone-alert",
        ruleType: "revenue_milestone_linking",
        ruleConfig: "14 days",
        title: "Revenue Milestone Date Alert",
        description: "Get alerted 14 days before revenue milestone due dates to ensure timely invoicing and collection",
        severity: "warning",
        reason: `${unlinkedMilestones.length} revenue milestone(s) have no date alerts configured`,
      });
    }

    const largeExpensesNoPo = expenses.filter((e: any) => {
      const amount = Number(e.expenseActualTotal) || 0;
      const po = (e.expensePoNumber || "").trim();
      return amount > 50000 && !po;
    });
    if (largeExpensesNoPo.length > 0 && !existingRuleTypes.has("expenditure_auto_flag")) {
      const totalNoPo = largeExpensesNoPo.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
      suggestions.push({
        id: "suggest-po-requirement",
        ruleType: "expenditure_auto_flag",
        ruleConfig: JSON.stringify({ requirePO: true, threshold: 50000 }),
        title: "PO Requirement for Large Expenses",
        description: "Auto-flag expenses over R50,000 that don't have a purchase order number",
        severity: "warning",
        reason: `${largeExpensesNoPo.length} expense(s) totalling R${(totalNoPo / 1000).toFixed(0)}k exceed R50k without a PO`,
      });
    }

    if (revSummary) {
      const actualProfit = Number(revSummary.actualProfit) || 0;
      const actualMargin = Number(revSummary.actualMargin) || 0;
      if (actualProfit < 0 || actualMargin < 0) {
        suggestions.push({
          id: "suggest-margin-protection",
          ruleType: "critical_path_protection",
          ruleConfig: JSON.stringify({ marginFloor: "0%", alertOnNegative: true }),
          title: "GP Margin Protection",
          description: "Enable alerts when gross profit margin drops below zero to prevent further losses",
          severity: "critical",
          reason: `Current GP margin is ${(actualMargin * 100).toFixed(1)}% — project is loss-making`,
        });
      }
    }

    if (!existingRuleTypes.has("variance_alert_threshold")) {
      suggestions.push({
        id: "suggest-variance-threshold",
        ruleType: "variance_alert_threshold",
        ruleConfig: JSON.stringify({ threshold: "15%", compareField: "budget_vs_actual" }),
        title: "Budget Variance Alert",
        description: "Get notified when any expense category deviates more than 15% from budget",
        severity: "info",
        reason: "No variance threshold rules are configured for this project",
      });
    }

    res.json({ suggestions });
  } catch (error: any) {
    console.error("[fin-integration] Suggested rules error:", error);
    res.status(500).json({ error: "Failed to generate suggested rules" });
  }
});

export { router as financialIntegrationRouter };
