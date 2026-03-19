// @ts-nocheck
import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, requireAdmin } from "./shared-middleware";
import { storage } from "../storage";
import { db } from "../db";
import { financialEditRequests, financialIntegrationRules, users, workItems, projectInfo, expenseTaskLinks, milestoneTaskLinks } from "@shared/schema";
import { eq, and, inArray, isNull, desc, sql } from "drizzle-orm";

const router = Router();

const FINANCIAL_APPROVER_ROLES = ["COO_ADMIN", "CEO_ADMIN", "admin", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER"];
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
    const piRow = await db.select({ id: projectInfo.id }).from(projectInfo)
      .where(eq(projectInfo.projectName, projectName)).limit(1);
    if (piRow.length === 0) return false;
    const tasks = await db.select().from(workItems)
      .where(and(eq(workItems.projectId, piRow[0].id), isNull(workItems.deletedAt)));
    const relevantTasks = tasks.filter(t => taskIds.includes(t.sourceRow || t.id));
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
    const links = await db.select().from(milestoneTaskLinks)
      .where(eq(milestoneTaskLinks.projectName, projectName));
    const linkedTaskIds = links.map(l => l.taskId);
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
    const links = await db.select().from(expenseTaskLinks)
      .where(eq(expenseTaskLinks.projectName, projectName));
    const linkedTaskIds = links.map(l => l.taskId);
    for (const tid of taskIds) {
      if (linkedTaskIds.includes(tid) || linkedTaskIds.includes(-tid)) return true;
    }
  } catch (err) {
    console.warn("[fin-integration] Expenditure impact detection failed:", err);
  }
  return false;
}

// Notifications feature removed - sendFinancialWarningNotifications is now a no-op
async function sendFinancialWarningNotifications(
  _projectName: string,
  _editSummary: string,
  _flags: { isCriticalPath: boolean; affectsRevenue: boolean; affectsExpenditure: boolean; affectsQuality: boolean },
  _requestedByUserId: number,
  _requestId: number
) {
  // no-op: notifications feature removed
}

// Notifications feature removed - sendIntegrationWarningNotifications is now a no-op
async function sendIntegrationWarningNotifications(
  _projectName: string,
  _warningType: string,
  _title: string,
  _body: string,
  _linkedTaskId?: number
) {
  // no-op: notifications feature removed
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
      const [saved] = await db.insert(financialEditRequests).values({
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
      }).returning();

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

    const [saved] = await db.insert(financialEditRequests).values({
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
    }).returning();

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

    let conditions: any[] = [];
    if (projectName && typeof projectName === "string") {
      conditions.push(eq(financialEditRequests.projectName, projectName));
    }
    if (filterStatus && typeof filterStatus === "string") {
      conditions.push(eq(financialEditRequests.status, filterStatus));
    }

    if (!isApproverRole(userRole)) {
      conditions.push(eq(financialEditRequests.requestedByUserId, userId));
    }

    const results = await db.select({
      request: financialEditRequests,
      requestedBy: { id: users.id, name: users.name, role: users.role },
    })
      .from(financialEditRequests)
      .leftJoin(users, eq(financialEditRequests.requestedByUserId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(financialEditRequests.createdAt))
      .limit(100);

    res.json(results.map(r => ({
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

    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(financialEditRequests)
      .where(eq(financialEditRequests.status, "pending"));

    res.json({ count: result?.count || 0 });
  } catch (error) {
    res.status(500).json({ error: "Failed to get count" });
  }
});

router.post("/api/financial-edit-requests/:id/approve", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const requestId = parseInt(req.params.id);
    const userId = req.user!.id;
    const { comment } = req.body;

    const [existing] = await db.select().from(financialEditRequests).where(eq(financialEditRequests.id, requestId));
    if (!existing) return res.status(404).json({ error: "Request not found" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Request is not pending" });

    const [updated] = await db.update(financialEditRequests)
      .set({
        status: "approved",
        reviewedByUserId: userId,
        reviewComment: comment || null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(financialEditRequests.id, requestId))
      .returning();

    // Notifications feature removed - approval notification is now a no-op

    res.json({ message: "Edit request approved", request: updated });
  } catch (error: any) {
    console.error("[fin-edit-request] Approve error:", error);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

router.post("/api/financial-edit-requests/:id/reject", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const requestId = parseInt(req.params.id);
    const userId = req.user!.id;
    const { comment } = req.body;

    if (!comment || typeof comment !== "string" || comment.trim().length < 3) {
      return res.status(400).json({ error: "Rejection requires a comment (min 3 characters)" });
    }

    const [existing] = await db.select().from(financialEditRequests).where(eq(financialEditRequests.id, requestId));
    if (!existing) return res.status(404).json({ error: "Request not found" });
    if (existing.status !== "pending") return res.status(400).json({ error: "Request is not pending" });

    const [updated] = await db.update(financialEditRequests)
      .set({
        status: "rejected",
        reviewedByUserId: userId,
        reviewComment: comment.trim(),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(financialEditRequests.id, requestId))
      .returning();

    // Notifications feature removed - rejection notification is now a no-op

    res.json({ message: "Edit request rejected", request: updated });
  } catch (error: any) {
    console.error("[fin-edit-request] Reject error:", error);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

router.get("/api/financial-integration/warnings/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = req.params.projectName;
    const warnings: { type: string; severity: string; message: string; details?: any }[] = [];

    const expenses = await storage.getProgramExpensesByProject(projectName);
    const inflows = await storage.getProgramInflowsByProject(projectName);
    const piRow = await db.select({ id: projectInfo.id }).from(projectInfo)
      .where(eq(projectInfo.projectName, projectName)).limit(1);
    const planTasks = piRow.length > 0
      ? await db.select().from(workItems).where(and(eq(workItems.projectId, piRow[0].id), isNull(workItems.deletedAt)))
      : [];
    const expLinks = await db.select().from(expenseTaskLinks).where(eq(expenseTaskLinks.projectName, projectName));
    const revLinks = await db.select().from(milestoneTaskLinks).where(eq(milestoneTaskLinks.projectName, projectName));

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

    const totalRevenue = inflows.reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
    if (totalRevenue > 0 && totalActual > totalRevenue) {
      warnings.push({
        type: "cos_exceeds_revenue",
        severity: "critical",
        message: `COS (R${(totalActual / 1000).toFixed(0)}k) exceeds total revenue (R${(totalRevenue / 1000).toFixed(0)}k)`,
        details: { totalActual, totalRevenue },
      });
    }

    const unlinkedExpenses = expenses.filter((e: any) => {
      const amount = Number(e.expenseActualTotal) || 0;
      if (amount === 0) return false;
      return !expLinks.some(l => l.expenseId === e.id);
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
      return !revLinks.some(l => l.milestoneRowNumber === r.rowNumber);
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
      const task = planTasks.find(t => (t.sourceRow || t.id) === taskId);
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
      const task = planTasks.find(t => (t.sourceRow || t.id) === taskId);
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

    const overdueTasks = planTasks.filter(t => {
      const pct = Number(t.percentComplete || 0);
      return t.endDate && t.endDate < today && pct < 1;
    });
    const criticalOverdue = overdueTasks.filter(t => (t as any).isCriticalPath);
    if (criticalOverdue.length > 0) {
      warnings.push({
        type: "critical_path_delay",
        severity: "critical",
        message: `${criticalOverdue.length} critical path task(s) overdue — may delay handover`,
        details: { tasks: criticalOverdue.map(t => ({ name: t.title, endDate: t.endDate })) },
      });
    }

    const pendingEdits = await db.select({ count: sql<number>`count(*)::int` })
      .from(financialEditRequests)
      .where(and(eq(financialEditRequests.projectName, projectName), eq(financialEditRequests.status, "pending")));
    if ((pendingEdits[0]?.count || 0) > 0) {
      warnings.push({
        type: "pending_edits",
        severity: "info",
        message: `${pendingEdits[0].count} edit request(s) pending approval`,
        details: { count: pendingEdits[0].count },
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
    const projectName = req.params.projectName;

    const expenses = await storage.getProgramExpensesByProject(projectName);
    const inflows = await storage.getProgramInflowsByProject(projectName);
    const piRowSync = await db.select({ id: projectInfo.id }).from(projectInfo)
      .where(eq(projectInfo.projectName, projectName)).limit(1);
    const planTasks = piRowSync.length > 0
      ? await db.select().from(workItems).where(and(eq(workItems.projectId, piRowSync[0].id), isNull(workItems.deletedAt)))
      : [];
    const expLinks = await db.select().from(expenseTaskLinks).where(eq(expenseTaskLinks.projectName, projectName));
    const revLinks = await db.select().from(milestoneTaskLinks).where(eq(milestoneTaskLinks.projectName, projectName));

    const totalExpenses = expenses.length;
    const linkedExpenses = expenses.filter((e: any) => expLinks.some(l => l.expenseId === e.id)).length;
    const totalMilestones = inflows.filter((r: any) => Number(r.milestoneAmount) > 0).length;
    const linkedMilestones = inflows.filter((r: any) => revLinks.some(l => l.milestoneRowNumber === r.rowNumber)).length;
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
    const projectName = req.params.projectName;
    const rules = await db.select({
      rule: financialIntegrationRules,
      createdBy: { id: users.id, name: users.name },
    })
      .from(financialIntegrationRules)
      .leftJoin(users, eq(financialIntegrationRules.createdByUserId, users.id))
      .where(eq(financialIntegrationRules.projectName, projectName))
      .orderBy(desc(financialIntegrationRules.createdAt));

    res.json(rules.map(r => ({
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

    const [saved] = await db.insert(financialIntegrationRules).values({
      projectName,
      ruleType,
      ruleConfig: typeof ruleConfig === "string" ? ruleConfig : JSON.stringify(ruleConfig),
      isActive: true,
      createdByUserId: userId,
    }).returning();

    res.json(saved);
  } catch (error: any) {
    console.error("[fin-rules] Create error:", error);
    res.status(500).json({ error: "Failed to create rule" });
  }
});

router.patch("/api/financial-integration/rules/:ruleId", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const ruleId = parseInt(req.params.ruleId);
    const { ruleConfig, isActive } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (ruleConfig !== undefined) {
      updates.ruleConfig = typeof ruleConfig === "string" ? ruleConfig : JSON.stringify(ruleConfig);
    }
    if (isActive !== undefined) {
      updates.isActive = isActive;
    }

    const [updated] = await db.update(financialIntegrationRules)
      .set(updates)
      .where(eq(financialIntegrationRules.id, ruleId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Rule not found" });
    res.json(updated);
  } catch (error: any) {
    console.error("[fin-rules] Update error:", error);
    res.status(500).json({ error: "Failed to update rule" });
  }
});

router.delete("/api/financial-integration/rules/:ruleId", requireAuth, requireFinancialApprover, async (req: Request, res: Response) => {
  try {
    const ruleId = parseInt(req.params.ruleId);
    const [deleted] = await db.delete(financialIntegrationRules)
      .where(eq(financialIntegrationRules.id, ruleId))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[fin-rules] Delete error:", error);
    res.status(500).json({ error: "Failed to delete rule" });
  }
});

router.get("/api/financial-integration/suggested-rules/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = req.params.projectName;
    const suggestions: {
      id: string;
      ruleType: string;
      ruleConfig: string;
      title: string;
      description: string;
      severity: "critical" | "warning" | "info";
      reason: string;
    }[] = [];

    const expenses = await storage.getProgramExpensesByProject(projectName);
    const inflows = await storage.getProgramInflowsByProject(projectName);
    const planTasks = await storage.getProjectPlansByProject(projectName);
    const revSummary = await storage.getProjectRevenueSummary(projectName);

    const existingRules = await db.select()
      .from(financialIntegrationRules)
      .where(and(eq(financialIntegrationRules.projectName, projectName), eq(financialIntegrationRules.isActive, true)));

    const existingRuleTypes = new Set(existingRules.map(r => r.ruleType));

    const expLinks = await db.select().from(expenseTaskLinks).where(eq(expenseTaskLinks.projectName, projectName));
    const revLinks = await db.select().from(milestoneTaskLinks).where(eq(milestoneTaskLinks.projectName, projectName));

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
    const unlinkedExpenses = expensesWithAmount.filter((e: any) => !expLinks.some(l => l.expenseId === e.id));
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
    const unlinkedMilestones = milestonesWithAmount.filter((r: any) => !revLinks.some(l => l.milestoneRowNumber === r.rowNumber));
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
