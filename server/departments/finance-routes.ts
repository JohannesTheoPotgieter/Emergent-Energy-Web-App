// @ts-nocheck
import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { requirePermission } from "../permission-middleware";
import { requireTrackerPermission } from "../lib/finance-route-access";
import { z } from "zod";
import {
  approvals,
  changeSets,
  cosStatusOverrides,
  fieldChanges,
  financialEditRequests,
  insertBudgetSchema,
  msObjects,
  normalizedRevenueLines,
  OVERRIDE_CATEGORIES,
  projectInfo,
  users,
} from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import {
  STATIC_COS_BUDGET_FY26,
  extractMonthKey,
  allocateRevenue,
  isCosRealised as isCosRealisedShared,
  normalizeProjectName,
  mapToSortedArray,
  currentMonthKey as getCurrentMonthKey,
  parseExpenseAmount,
} from "../lib/calculations/financeUtils";
import { recordOverride } from "../lib/audit/diff-engine";
import { isWorkItemsEnabled, getWorkItemsAsOperationalTasks } from "../work-items-adapter";
import { refreshProjectMetricsAsync } from "../services/dashboard-metrics";

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

  // Notifications feature removed - financial edit request notifications are now no-ops

  return saved;
}

const router = Router();

function isDateConfirmed(confirmed: boolean | null | undefined, fontColor: string | null | undefined): boolean {
  if (fontColor === 'red') return false;
  if (fontColor === 'black') return true;
  if (confirmed === true) return true;
  return false;
}

// Delegates to shared utility in financeUtils.ts (aligned with classifyCosStatus).
// Respects COS overrides and the cosRealised boolean from normalizedCostLines.
function isCosRealised(exp: any): boolean {
  return isCosRealisedShared(exp);
}

// DEPRECATED: Override data is now baked into base table rows (Prompt 4 — override collapse).
// COS status overrides are applied directly to program_expense.line_status.
// These functions are kept as no-ops for backward compatibility during transition.
async function loadCosOverrides(): Promise<Map<string, string>> {
  return new Map<string, string>();
}

function enrichWithOverrides(_expenses: any[], _cosOverrideMap: Map<string, string>): void {
  // No-op: COS overrides are baked into base rows
}

function isCashflowConfirmed(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  return isDateConfirmed(exp.paymentDateConfirmed, exp.paymentDateFontColor);
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

// DEPRECATED: Override data is now baked into base table rows (Prompt 4 — override collapse).
function applyPlanningOverrides(baselinePoints: any[], _overrides: any[]): any[] {
  return baselinePoints;
}

// DEPRECATED: Override data is now baked into base table rows (Prompt 4 — override collapse).
function applyRevenueTrackingOverrides(baselineRows: any[], _overrides: any[]): any[] {
  return baselineRows;
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

// DEPRECATED: Override data is now baked into base table rows (Prompt 4 — override collapse).
function applyExpenditureOverrides(baselineRows: any[], _overrides: any[]): any[] {
  return baselineRows;
}

// DEPRECATED: Override data is now baked into base table rows (Prompt 4 — override collapse).
function applyFinanceRevenueOverrides(baselineData: any[], _overrides: any[]): any[] {
  return baselineData;
}

// DEPRECATED: Override data is now baked into base table rows (Prompt 4 — override collapse).
function applyFinanceCosOverrides(baselineData: any[], _overrides: any[]): any[] {
  return baselineData;
}

function normalizeOverrideValue(value: any): any {
  if (value === "__null__") return null;
  return value;
}

function formatChangeUserName(
  actorUserId: number | null | undefined,
  actorRole: string | null | undefined,
  userNameById: Map<number, string>
): string | null {
  if (actorUserId && userNameById.has(actorUserId)) {
    return userNameById.get(actorUserId)!;
  }
  return actorRole || null;
}

function buildFieldChangesByChangeSet(changeRows: any[], fieldRows: any[]) {
  const byChangeSet = new Map<number, any[]>();
  for (const field of fieldRows) {
    const existing = byChangeSet.get(field.changeSetId) || [];
    existing.push(field);
    byChangeSet.set(field.changeSetId, existing);
  }

  const latestByEntity = new Map<string, any>();
  for (const change of changeRows) {
    if (!change.entityId || latestByEntity.has(change.entityId)) continue;
    latestByEntity.set(change.entityId, {
      ...change,
      fieldChanges: byChangeSet.get(change.id) || [],
    });
  }

  return { byChangeSet, latestByEntity };
}

function toRecentChangeSummary(changeRows: any[], fieldRowsByChangeSet: Map<number, any[]>, userNameById: Map<number, string>) {
  return changeRows.slice(0, 5).map((change) => ({
    id: change.id,
    action: change.action,
    entityId: change.entityId,
    summary: change.summary,
    actorRole: change.actorRole,
    actorUserId: change.actorUserId,
    actorName: formatChangeUserName(change.actorUserId, change.actorRole, userNameById),
    overrideCategory: change.overrideCategory,
    overrideComment: change.overrideComment,
    createdAt: change.createdAt,
    changedFields: (fieldRowsByChangeSet.get(change.id) || []).map((field) => ({
      fieldName: field.fieldName,
      oldValue: field.oldValue,
      newValue: field.newValue,
    })),
  }));
}

function buildRevenueFieldAudit(
  projectName: string,
  rowNumber: number,
  fieldName: string,
  sourceValue: any,
  managedValue: any,
  overrideRecord: any | undefined,
  latestChangeByEntity: Map<string, any>,
  userNameById: Map<number, string>
) {
  const entityId = `${projectName}|row${rowNumber}|${fieldName}`;
  const latestChange = latestChangeByEntity.get(entityId);
  const fieldChange = latestChange?.fieldChanges?.find((field: any) => field.fieldName === fieldName);
  return {
    fieldName,
    sourceValue,
    managedValue,
    overrideValue: overrideRecord ? normalizeOverrideValue(overrideRecord.overrideValue) : null,
    changedAt: overrideRecord?.updatedAt || overrideRecord?.createdAt || latestChange?.createdAt || null,
    changedByUserId: overrideRecord?.createdBy || latestChange?.actorUserId || null,
    changedByName: overrideRecord?.createdBy ? userNameById.get(overrideRecord.createdBy) || null : formatChangeUserName(latestChange?.actorUserId, latestChange?.actorRole, userNameById),
    overrideCategory: latestChange?.overrideCategory || null,
    overrideComment: latestChange?.overrideComment || null,
    previousValue: fieldChange?.oldValue ?? sourceValue ?? null,
  };
}

function buildExpenditureFieldAudit(
  projectName: string,
  rowNumber: number,
  fieldName: string,
  managedValue: any,
  overrideRecord: any | undefined,
  latestChangeByEntity: Map<string, any>,
  userNameById: Map<number, string>
) {
  const entityId = `${projectName}|row${rowNumber}|${fieldName}`;
  const latestChange = latestChangeByEntity.get(entityId);
  const fieldChange = latestChange?.fieldChanges?.find((field: any) => field.fieldName === fieldName);
  const priorValue = fieldChange?.oldValue ?? null;

  return {
    fieldName,
    managedValue,
    sourceValue: priorValue ?? (overrideRecord ? null : managedValue),
    overrideValue: overrideRecord ? normalizeOverrideValue(overrideRecord.overrideValue) : null,
    previousValue: priorValue,
    changedAt: overrideRecord?.updatedAt || overrideRecord?.createdAt || latestChange?.createdAt || null,
    changedByUserId: overrideRecord?.createdBy || latestChange?.actorUserId || null,
    changedByName: overrideRecord?.createdBy ? userNameById.get(overrideRecord.createdBy) || null : formatChangeUserName(latestChange?.actorUserId, latestChange?.actorRole, userNameById),
    overrideCategory: latestChange?.overrideCategory || null,
    overrideComment: latestChange?.overrideComment || null,
  };
}

function auditValuesDiffer(left: any, right: any): boolean {
  return String(left ?? "") !== String(right ?? "");
}

function isFinanceApprovalRecord(approval: {
  type?: string | null;
  title?: string | null;
  description?: string | null;
  approvalCategory?: string | null;
  relatedEntityType?: string | null;
}): boolean {
  const haystack = [
    approval.type,
    approval.title,
    approval.description,
    approval.approvalCategory,
    approval.relatedEntityType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack) return false;

  return [
    "finance",
    "financial",
    "cash",
    "invoice",
    "revenue",
    "budget",
    "commercial",
    "cost",
    "procurement",
    "purchase",
    "variation",
    "change",
    "vo",
  ].some((keyword) => haystack.includes(keyword));
}

async function loadProjectFinanceGovernanceContext(
  projectName: string,
  projectId?: number | null,
  extraUserIds: number[] = []
) {
  const [approvalRows, editRequestRows, changeRows, microsoftRows] = await Promise.all([
    projectId
      ? db
          .select({
            id: approvals.id,
            type: approvals.type,
            title: approvals.title,
            description: approvals.description,
            status: approvals.status,
            dueDate: approvals.dueDate,
            requestedAt: approvals.requestedAt,
            approvalCategory: approvals.approvalCategory,
            relatedEntityType: approvals.relatedEntityType,
          })
          .from(approvals)
          .where(eq(approvals.projectId, projectId))
          .orderBy(desc(approvals.requestedAt))
          .limit(25)
      : Promise.resolve([] as any[]),
    db
      .select({
        id: financialEditRequests.id,
        editType: financialEditRequests.editType,
        editTarget: financialEditRequests.editTarget,
        editSummary: financialEditRequests.editSummary,
        affectsRevenue: financialEditRequests.affectsRevenue,
        affectsExpenditure: financialEditRequests.affectsExpenditure,
        status: financialEditRequests.status,
        createdAt: financialEditRequests.createdAt,
        requestedByUserId: financialEditRequests.requestedByUserId,
        requestedByName: users.name,
      })
      .from(financialEditRequests)
      .leftJoin(users, eq(financialEditRequests.requestedByUserId, users.id))
      .where(eq(financialEditRequests.projectName, projectName))
      .orderBy(desc(financialEditRequests.createdAt))
      .limit(25),
    db
      .select({
        id: changeSets.id,
        actorRole: changeSets.actorRole,
        actorUserId: changeSets.actorUserId,
        entityType: changeSets.entityType,
        entityId: changeSets.entityId,
        action: changeSets.action,
        summary: changeSets.summary,
        overrideCategory: changeSets.overrideCategory,
        overrideComment: changeSets.overrideComment,
        createdAt: changeSets.createdAt,
      })
      .from(changeSets)
      .where(eq(changeSets.projectName, projectName))
      .orderBy(desc(changeSets.createdAt))
      .limit(40),
    projectId
      ? db
          .select({
            id: msObjects.id,
            type: msObjects.type,
            subjectOrTitle: msObjects.subjectOrTitle,
            preview: msObjects.preview,
            webLink: msObjects.webLink,
            actionRequired: msObjects.actionRequired,
            isRead: msObjects.isRead,
            linkedTaskId: msObjects.linkedTaskId,
            receivedOrStartDatetime: msObjects.receivedOrStartDatetime,
          })
          .from(msObjects)
          .where(eq(msObjects.linkedProjectId, projectId))
          .orderBy(desc(msObjects.receivedOrStartDatetime))
          .limit(25)
      : Promise.resolve([] as any[]),
  ]);

  const changeSetIds = changeRows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  const changeFieldRows = changeSetIds.length
    ? await db.select().from(fieldChanges).where(inArray(fieldChanges.changeSetId, changeSetIds))
    : [];

  const userIds = Array.from(
    new Set(
      [
        ...extraUserIds,
        ...changeRows.map((row) => row.actorUserId),
        ...editRequestRows.map((row) => row.requestedByUserId),
      ].filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    )
  );

  const userRows = userIds.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
        })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];

  const userNameById = new Map<number, string>(
    userRows.map((row) => [row.id, row.name || `User ${row.id}`])
  );

  const { byChangeSet, latestByEntity } = buildFieldChangesByChangeSet(changeRows, changeFieldRows);
  const pendingApprovals = approvalRows.filter((row) => row.status === "pending");
  const cashAffectingApprovals = pendingApprovals.filter((row) => isFinanceApprovalRecord(row));
  const pendingEditRequests = editRequestRows.filter((row) => row.status === "pending");

  return {
    latestChangeByEntity: latestByEntity,
    userNameById,
    recentChanges: toRecentChangeSummary(changeRows, byChangeSet, userNameById),
    approvals: {
      pendingCount: pendingApprovals.length,
      affectingCashCount: cashAffectingApprovals.length,
      pending: cashAffectingApprovals.slice(0, 5).map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        approvalCategory: row.approvalCategory,
        dueDate: row.dueDate,
        requestedAt: row.requestedAt,
      })),
    },
    editRequests: {
      pendingCount: pendingEditRequests.length,
      pending: pendingEditRequests.slice(0, 5).map((row) => ({
        id: row.id,
        editType: row.editType,
        editTarget: row.editTarget,
        editSummary: row.editSummary,
        affectsRevenue: row.affectsRevenue,
        affectsExpenditure: row.affectsExpenditure,
        requestedByName: row.requestedByName || userNameById.get(row.requestedByUserId) || null,
        createdAt: row.createdAt,
      })),
    },
    microsoft: {
      linkedCount: microsoftRows.length,
      actionRequiredCount: microsoftRows.filter((row) => row.actionRequired).length,
      unreadCount: microsoftRows.filter((row) => row.isRead === false).length,
      linkedTaskCount: microsoftRows.filter((row) => row.linkedTaskId != null).length,
      recent: microsoftRows.slice(0, 5).map((row) => ({
        id: row.id,
        type: row.type,
        subjectOrTitle: row.subjectOrTitle,
        preview: row.preview,
        webLink: row.webLink,
        actionRequired: !!row.actionRequired,
        isRead: row.isRead,
        linkedTaskId: row.linkedTaskId,
        receivedOrStartDatetime: row.receivedOrStartDatetime,
      })),
    },
  };
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

router.get("/api/program/cos", requireAuth, async (req, res) => {
  try {
    const { projectName, startDate, endDate, atRiskDays = '30' } = req.query;
    const atRiskDaysNum = parseInt(atRiskDays as string, 10) || 30;

    const [allExpenses, latestRefresh, cosOverrideMapCos] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getLatestRefresh(),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allExpenses, cosOverrideMapCos);

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

router.get("/api/cashflow-2026", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
  try {
    const projectFilterRaw = req.query.project ? String(req.query.project) : null;
    const projectFilters: Set<string> | null = projectFilterRaw
      ? new Set(projectFilterRaw.split(",").map(s => s.trim()).filter(Boolean))
      : null;
    const isFiltered = projectFilters !== null && projectFilters.size > 0;

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
        if (projectFilters && !projectFilters.has(inflow.projectName || "")) continue;
        const d = inflow.effectiveDate;
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        if (d >= weekStart && d < weekEnd && inflow.milestoneAmount) {
          projectInflowsSum += parseFloat(inflow.milestoneAmount) || 0;
        }
      }

      let projectOutflowsSum = 0;
      let pastDueUnpaidSum = 0;
      const todayStr = new Date().toISOString().split('T')[0];
      for (const expense of allExpenses) {
        if (projectFilters && !projectFilters.has(expense.projectName || "")) continue;
        // Use effective payment date: actual payment date, then forecast, then linked task
        const d = expense.expensePaymentDate || (expense as any).forecastPaymentDate || (expense as any).computedForecastPaymentDate || null;
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        if (d >= weekStart && d < weekEnd && expense.expenseActualTotal) {
          const amt = parseFloat(expense.expenseActualTotal) || 0;
          projectOutflowsSum += amt;
          // Flag past-due unpaid: payment date in past, but not confirmed out of bank
          const payDateConfirmed = expense.expensePaymentDate && isDateConfirmed((expense as any).paymentDateConfirmed, (expense as any).paymentDateFontColor);
          if (d < todayStr && !payDateConfirmed && amt > 0) {
            pastDueUnpaidSum += amt;
          }
        }
      }

      const computedOpening = runningBalance;
      const hasManualOverride = !isFiltered && manualMap.has(weekStart);
      const openingBalance = hasManualOverride ? manualMap.get(weekStart)! : computedOpening;
      const balanceDelta = hasManualOverride ? openingBalance - computedOpening : 0;

      const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      let opexOutflows = 0;
      let computedOpex = 0;
      let hasOpexOverride = false;
      if (!isFiltered) {
        const monthlyOpex = opexMonthlyMap.get(mk) || 0;
        const weeksCount = weeksInMonth.get(mk) || 1;
        computedOpex = monthlyOpex / weeksCount;
        hasOpexOverride = opexWeeklyMap.has(weekStart);
        opexOutflows = hasOpexOverride ? opexWeeklyMap.get(weekStart)! : computedOpex;
      }

      const closingBalance = openingBalance + projectInflowsSum - opexOutflows - projectOutflowsSum;
      const availablePayment = openingBalance + projectInflowsSum;

      weeks.push({
        weekStart,
        weekEnd,
        projectInflows: projectInflowsSum,
        projectOutflows: projectOutflowsSum,
        pastDueUnpaid: pastDueUnpaidSum,
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

router.get("/api/cashflow-2026/detail", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
  try {
    const weekStart = String(req.query.week || "");
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "Invalid week parameter", message: "Provide ?week=YYYY-MM-DD" });
    }
    const projectFilterRaw = req.query.project ? String(req.query.project) : null;
    const projectFilters: Set<string> | null = projectFilterRaw
      ? new Set(projectFilterRaw.split(",").map(s => s.trim()).filter(Boolean))
      : null;

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
        if (projectFilters && !projectFilters.has(e.projectName || "")) return false;
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
        if (projectFilters && !projectFilters.has(inf.projectName || "")) return false;
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

router.post("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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

router.get("/api/cashflow-2026/balance-history", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
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

router.delete("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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

router.post("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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

router.get("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
  try {
    const entries = await storage.getAllOpexBudgetMonthly();
    res.json(entries);
  } catch (error) {
    console.error("OPEX budget fetch error:", error);
    res.status(500).json({ error: "Failed to fetch OPEX budgets", message: "Failed to fetch OPEX budgets" });
  }
});

router.post("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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

router.delete("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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

router.post("/api/tracker-monthly", requireAuth, requireTrackerPermission("edit"), async (req, res) => {
  try {
    const { trackerType, monthKey, realised, outstanding, budget } = req.body;
    if (!trackerType || !monthKey) {
      return res.status(400).json({ error: "trackerType and monthKey required" });
    }
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: "monthKey must be in YYYY-MM format" });
    }
    if (!["COS", "REV", "GP"].includes(trackerType)) {
      return res.status(400).json({ error: "trackerType must be COS, REV, or GP" });
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

router.get("/api/tracker-monthly/:type", requireAuth, requireTrackerPermission("view"), async (req, res) => {
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
          planned += parseFloat(inflow.milestoneAmount) || 0;
        }
      }

      const manual = manualMap.get(monthKey);
      const realised = manual?.realised ? parseFloat(manual.realised) : 0;
      const outstanding = manual?.outstanding ? parseFloat(manual.outstanding) : 0;
      const budget = manual?.budget ? parseFloat(manual.budget) : 0;

      const variance = planned - budget;
      const variancePct = budget !== 0 ? ((planned - budget) / budget) * 100 : 0;

      ytdPlanned += planned;
      ytdRealised += realised;
      ytdOutstanding += outstanding;
      ytdBudget += budget;
      const ytdVariance = ytdPlanned - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? ((ytdPlanned - ytdBudget) / ytdBudget) * 100 : 0;

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
    const [allProgramExpenses, manualEntries, rawInflows, allTaskLinks, allOpTasks, allPlans, cosOverrideMap] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getTrackerMonthlyManual('COS'),
      storage.getAllProgramInflows(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allProgramExpenses, cosOverrideMap);
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

    // Uses shared static COS budget from financeUtils.ts (single source of truth)
    const staticCosBudget = STATIC_COS_BUDGET_FY26;

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));

    let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0, ytdRevRealised = 0;

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
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      const revRealised = revByMonth.get(monthKey) ?? 0;
      ytdCOS += totalCOS;
      ytdRealised += realisedCOS;
      ytdBudget += budget;
      ytdRevRealised += revRealised;
      const ytdUnrealised = ytdCOS - ytdRealised;
      const ytdVariance = ytdCOS - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

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
        cosProjects: mapToSortedArray(bucket?.projects ?? new Map()),
        realisedProjects: mapToSortedArray(realisedBucket?.projects ?? new Map()),
        unrealisedProjects: (() => {
          const cosPs = bucket?.projects ?? new Map<string, number>();
          const realPs = realisedBucket?.projects ?? new Map<string, number>();
          const unrealMap = new Map<string, number>();
          cosPs.forEach((v, k) => {
            const diff = v - (realPs.get(k) || 0);
            if (diff !== 0) unrealMap.set(k, diff);
          });
          return mapToSortedArray(unrealMap);
        })(),
      });
    }

    res.json(months);
  } catch (error) {
    console.error("COS tracker error:", error);
    res.status(500).json({ error: "Failed to fetch COS tracker data", message: "Failed to fetch COS tracker data" });
  }
});

router.get("/api/cos-tracker/project/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = decodeURIComponent(String(req.params.projectName || ""));
    const projectExpenses = await storage.getProgramExpensesByProject(projectName);

    const cosByMonth = new Map<string, number>();
    const realisedByMonth = new Map<string, number>();
    const itemsByMonth = new Map<string, any[]>();

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      cosByMonth.set(monthKey, (cosByMonth.get(monthKey) || 0) + amount);

      const isRealised = isCosRealised(exp) && monthKey <= currentMonthKey;
      if (isRealised) {
        realisedByMonth.set(monthKey, (realisedByMonth.get(monthKey) || 0) + amount);
      }

      if (!itemsByMonth.has(monthKey)) itemsByMonth.set(monthKey, []);
      itemsByMonth.get(monthKey)!.push({
        id: exp.id,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        amount,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: exp.expenseInvoicedDate || null,
        supplier: exp.supplierName || null,
        isRealised,
        cosStatus: isRealised ? 'Realised' : (exp.expenseInvoiceNumber ? 'Invoiced' : (exp.expensePoNumber ? 'Committed' : 'Planned')),
        paymentDate: exp.expensePaymentDate || null,
      });
    }

    const budgetByMonth = new Map<string, number>();
    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const budgetAmt = exp.budgetTotal ? parseFloat(exp.budgetTotal as string) : 0;
      if (isNaN(budgetAmt) || budgetAmt === 0) continue;
      const invDate = exp.expenseInvoicedDate as string | null;
      const startDate = invDate || (exp as any).startDate || null;
      if (!startDate) continue;
      const dateMatch = String(startDate).match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      budgetByMonth.set(monthKey, (budgetByMonth.get(monthKey) || 0) + budgetAmt);
    }

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const totalCOS = cosByMonth.get(monthKey) ?? 0;
      const realisedCOS = realisedByMonth.get(monthKey) ?? 0;
      const unrealisedCOS = totalCOS - realisedCOS;
      const budget = budgetByMonth.get(monthKey) ?? 0;
      const variance = totalCOS - budget;
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      ytdCOS += totalCOS;
      ytdRealised += realisedCOS;
      ytdBudget += budget;
      const ytdUnrealised = ytdCOS - ytdRealised;
      const ytdVariance = ytdCOS - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

      const monthItems = itemsByMonth.get(monthKey) || [];

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalCOS,
        realisedCOS,
        unrealisedCOS,
        budget,
        variance,
        variancePct,
        ytdCOS,
        ytdRealised,
        ytdUnrealised,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        itemCount: monthItems.length,
        realisedCount: monthItems.filter((it: any) => it.isRealised).length,
        items: monthItems,
      });
    }

    res.json(months);
  } catch (error) {
    console.error("Project COS tracker error:", error);
    res.status(500).json({ error: "Failed to fetch project COS tracker data" });
  }
});

router.get("/api/cos-tracker/month-detail", requireAuth, async (req, res) => {
  try {
    const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const match = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) return res.status(400).json({ error: "Invalid monthKey format" });

    const [allExpenses, cosOverrideMapMD] = await Promise.all([
      storage.getAllProgramExpenses(),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allExpenses, cosOverrideMapMD);

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
      const currentMonthKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;

      const isRealised = isCosRealised(exp) && (itemMonthKey ? itemMonthKey <= currentMonthKey : true);
      const isConfirmedPayment = isCashflowConfirmed(exp) && (itemMonthKey ? itemMonthKey <= currentMonthKey : true);

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
    const id = parseInt(String(req.params.id || ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });

    const { realised } = req.body as { realised: boolean };
    if (typeof realised !== 'boolean') return res.status(400).json({ error: "realised (boolean) required" });

    const allExpenses = await storage.getAllProgramExpenses();
    const expense = allExpenses.find(e => e.id === id);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    if (realised && !expense.expenseInvoiceNumber) {
      return res.status(400).json({ error: "Cannot mark as realised without an invoice number" });
    }

    if (realised && !expense.expenseInvoicedDate) {
      return res.status(400).json({ error: "Cannot mark as realised without an invoice date" });
    }

    const updated = await storage.updateProgramExpenseFields(id, {
      invoiceDateConfirmed: realised,
    });

    if (!updated) {
      return res.status(500).json({ error: "Failed to update expense fields" });
    }

    const newState = classifyExpenseState(updated as any);
    await storage.updateProgramExpenseFields(id, {
      computedState: newState,
    });

    res.json({ success: true, id, realised });
  } catch (error) {
    console.error("Toggle realised error:", error);
    res.status(500).json({ error: "Failed to toggle realised status" });
  }
});

// ==================== NO REVENUE LINKED TOGGLE ====================

router.patch("/api/cost-lines/:id/no-revenue-linked", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid cost line id" });
    const { noRevenueLinked } = req.body as { noRevenueLinked: boolean };
    if (typeof noRevenueLinked !== 'boolean') return res.status(400).json({ error: "noRevenueLinked (boolean) required" });
    await storage.updateProgramExpenseFields(id, { noRevenueLinked });
    res.json({ success: true, id, noRevenueLinked });
  } catch (error) {
    console.error("Toggle no-revenue-linked error:", error);
    res.status(500).json({ error: "Failed to toggle no-revenue-linked" });
  }
});

// ==================== REVENUE TRACKER ====================

router.get("/api/revenue-tracker/project/:projectName", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  try {
    const projectName = decodeURIComponent(String(req.params.projectName || ""));
    const [projectExpenses, revLines, manualEntries] = await Promise.all([
      storage.getProgramExpensesByProject(projectName),
      storage.getProgramInflowsByProject(projectName),
      storage.getTrackerMonthlyManual('REV'),
    ]);

    const manualBudgetMap = new Map(manualEntries.map(e => [e.monthKey, e]));

    const totalMilestoneRevenue = revLines.reduce((s: number, r: any) => {
      const amt = parseFloat(r.milestoneAmount as string) || 0;
      return s + amt;
    }, 0);

    const totalCOS = projectExpenses.reduce((s: number, exp: any) => {
      if (exp.rowType !== 'item') return s;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) return s;
      return s + amount;
    }, 0);

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    const revByMonth = new Map<string, number>();
    const realisedRevByMonth = new Map<string, number>();
    const itemsByMonth = new Map<string, any[]>();

    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      const revenueAmount = (totalCOS > 0 && !isNoRevLinked)
        ? (amount / totalCOS) * totalMilestoneRevenue
        : 0;

      revByMonth.set(monthKey, (revByMonth.get(monthKey) || 0) + revenueAmount);

      const cosRealised = isCosRealised(exp) && monthKey <= currentMonthKey;
      if (cosRealised) {
        realisedRevByMonth.set(monthKey, (realisedRevByMonth.get(monthKey) || 0) + revenueAmount);
      }

      if (!itemsByMonth.has(monthKey)) itemsByMonth.set(monthKey, []);
      itemsByMonth.get(monthKey)!.push({
        id: exp.id,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        costAmount: amount,
        revenueAmount,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: exp.expenseInvoicedDate || null,
        supplier: exp.supplierName || null,
        isRealised: cosRealised,
        noRevenueLinked: isNoRevLinked,
      });
    }

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdRevenue = 0, ytdRealised = 0, ytdBudget = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const totalRevenue = revByMonth.get(monthKey) ?? 0;
      const realisedRevenue = realisedRevByMonth.get(monthKey) ?? 0;
      const unrealisedRevenue = totalRevenue - realisedRevenue;

      const manual = manualBudgetMap.get(monthKey);
      const budget = manual?.budget ? parseFloat(manual.budget) : 0;
      const variance = totalRevenue - budget;
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      ytdRevenue += totalRevenue;
      ytdRealised += realisedRevenue;
      ytdBudget += budget;
      const ytdUnrealised = ytdRevenue - ytdRealised;
      const ytdVariance = ytdRevenue - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

      const monthItems = itemsByMonth.get(monthKey) || [];

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalRevenue,
        realisedRevenue,
        unrealisedRevenue,
        budget,
        variance,
        variancePct,
        ytdRevenue,
        ytdRealised,
        ytdUnrealised,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        itemCount: monthItems.length,
        realisedCount: monthItems.filter((it: any) => it.isRealised).length,
        items: monthItems,
      });
    }

    res.json({
      months,
      totalMilestoneRevenue,
      totalCOS,
    });
  } catch (error) {
    console.error("Project revenue tracker error:", error);
    res.status(500).json({ error: "Failed to fetch project revenue tracker data" });
  }
});

router.get("/api/gp-tracker", requireAuth, async (req, res) => {
  try {
    const [allExpenses, allInflowsRaw, revManualEntries, cosManualEntries, cosOverrideMap] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getTrackerMonthlyManual('REV'),
      storage.getTrackerMonthlyManual('COS'),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allExpenses, cosOverrideMap);

    const revManualBudgetMap = new Map(revManualEntries.map(e => [e.monthKey, e.budget ? parseFloat(e.budget) : 0]));
    const cosManualBudgetMap = new Map(cosManualEntries.map(e => [e.monthKey, e.budget ? parseFloat(e.budget) : 0]));

    // Uses shared static COS budget from financeUtils.ts (single source of truth)
    function getCosBudget(monthKey: string): number {
      const manual = cosManualBudgetMap.get(monthKey);
      if (manual && manual !== 0) return manual;
      return STATIC_COS_BUDGET_FY26[monthKey] ?? 0;
    }

    const revByProject = new Map<string, number>();
    for (const rev of allInflowsRaw) {
      const pName = (rev.projectName || "").replace(/_Tracker$/i, "");
      const amt = parseFloat(rev.milestoneAmount as string) || 0;
      revByProject.set(pName, (revByProject.get(pName) || 0) + amt);
    }

    const cosByProject = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;
      const pName = (exp.projectName || "").replace(/_Tracker$/i, "");
      cosByProject.set(pName, (cosByProject.get(pName) || 0) + amount);
    }

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    const cosByMonth = new Map<string, number>();
    const realisedCosByMonth = new Map<string, number>();
    const revByMonth = new Map<string, number>();
    const realisedRevByMonth = new Map<string, number>();
    const projectGpMap = new Map<string, { revenue: number; cos: number; gp: number; gpPct: number }>();

    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;
      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      const pName = (exp.projectName || "").replace(/_Tracker$/i, "");
      const totalCOSProject = cosByProject.get(pName) || 1;
      const totalRevProject = revByProject.get(pName) || 0;
      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      const revenueAmount = (totalCOSProject > 0 && !isNoRevLinked)
        ? (amount / totalCOSProject) * totalRevProject
        : 0;

      cosByMonth.set(monthKey, (cosByMonth.get(monthKey) || 0) + amount);
      revByMonth.set(monthKey, (revByMonth.get(monthKey) || 0) + revenueAmount);

      const cosRealised = isCosRealised(exp) && monthKey <= currentMonthKey;
      if (cosRealised) {
        realisedCosByMonth.set(monthKey, (realisedCosByMonth.get(monthKey) || 0) + amount);
        realisedRevByMonth.set(monthKey, (realisedRevByMonth.get(monthKey) || 0) + revenueAmount);
      }

      if (!projectGpMap.has(pName)) {
        projectGpMap.set(pName, { revenue: 0, cos: 0, gp: 0, gpPct: 0 });
      }
      const pg = projectGpMap.get(pName)!;
      pg.cos += amount;
      pg.revenue += revenueAmount;
      pg.gp = pg.revenue - pg.cos;
      pg.gpPct = pg.revenue !== 0 ? (pg.gp / pg.revenue) * 100 : 0;
    }

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdCOS = 0, ytdRevenue = 0, ytdBudget = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const totalCOS = cosByMonth.get(monthKey) ?? 0;
      const realisedCOS = realisedCosByMonth.get(monthKey) ?? 0;
      const totalRevenue = revByMonth.get(monthKey) ?? 0;
      const realisedRevenue = realisedRevByMonth.get(monthKey) ?? 0;
      const totalGP = totalRevenue - totalCOS;
      const realisedGP = realisedRevenue - realisedCOS;
      const unrealisedGP = totalGP - realisedGP;
      const gpPct = totalRevenue !== 0 ? (totalGP / totalRevenue) * 100 : 0;

      const revBudget = revManualBudgetMap.get(monthKey) || 0;
      const cosBudget = getCosBudget(monthKey);
      const budget = revBudget - cosBudget;
      const variance = totalGP - budget;
      const variancePct = budget !== 0 ? (totalGP - budget) / budget * 100 : 0;

      ytdCOS += totalCOS;
      ytdRevenue += totalRevenue;
      ytdBudget += budget;
      const ytdGP = ytdRevenue - ytdCOS;
      const ytdGpPct = ytdRevenue !== 0 ? (ytdGP / ytdRevenue) * 100 : 0;
      const ytdVariance = ytdGP - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdGP - ytdBudget) / ytdBudget * 100 : 0;

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalRevenue,
        totalCOS,
        totalGP,
        realisedGP,
        unrealisedGP,
        gpPct,
        revBudget,
        cosBudget,
        budget,
        variance,
        variancePct,
        ytdRevenue,
        ytdCOS,
        ytdGP,
        ytdGpPct,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
      });
    }

    const projects = Array.from(projectGpMap.entries())
      .map(([name, data]) => ({ projectName: name, ...data }))
      .sort((a, b) => b.gp - a.gp);

    const totalRevenue = Array.from(revByProject.values()).reduce((s, v) => s + v, 0);
    const totalCOS = Array.from(cosByProject.values()).reduce((s, v) => s + v, 0);
    const totalGP = totalRevenue - totalCOS;
    const overallGpPct = totalRevenue !== 0 ? (totalGP / totalRevenue) * 100 : 0;

    res.json({ months, projects, totalRevenue, totalCOS, totalGP, overallGpPct });
  } catch (error) {
    console.error("Portfolio GP tracker error:", error);
    res.status(500).json({ error: "Failed to fetch GP tracker data" });
  }
});

router.get("/api/gp-tracker/project/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = decodeURIComponent(String(req.params.projectName || ""));
    const [projectExpenses, revLines, cosOverrideMapProj] = await Promise.all([
      storage.getProgramExpensesByProject(projectName),
      storage.getProgramInflowsByProject(projectName),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(projectExpenses, cosOverrideMapProj);

    const totalMilestoneRevenue = revLines.reduce((s: number, r: any) => {
      const amt = parseFloat(r.milestoneAmount as string) || 0;
      return s + amt;
    }, 0);

    const totalCOSAll = projectExpenses.reduce((s: number, exp: any) => {
      if (exp.rowType !== 'item') return s;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) return s;
      return s + amount;
    }, 0);

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    const cosByMonth = new Map<string, number>();
    const realisedCosByMonth = new Map<string, number>();
    const revByMonth = new Map<string, number>();
    const realisedRevByMonth = new Map<string, number>();
    const itemsByMonth = new Map<string, any[]>();

    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      cosByMonth.set(monthKey, (cosByMonth.get(monthKey) || 0) + amount);

      const cosRealised = isCosRealised(exp) && monthKey <= currentMonthKey;
      if (cosRealised) {
        realisedCosByMonth.set(monthKey, (realisedCosByMonth.get(monthKey) || 0) + amount);
      }

      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      const revenueAmount = (totalCOSAll > 0 && !isNoRevLinked)
        ? (amount / totalCOSAll) * totalMilestoneRevenue
        : 0;

      revByMonth.set(monthKey, (revByMonth.get(monthKey) || 0) + revenueAmount);
      if (cosRealised) {
        realisedRevByMonth.set(monthKey, (realisedRevByMonth.get(monthKey) || 0) + revenueAmount);
      }

      if (!itemsByMonth.has(monthKey)) itemsByMonth.set(monthKey, []);
      itemsByMonth.get(monthKey)!.push({
        id: exp.id,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        costAmount: amount,
        revenueAmount,
        gpAmount: revenueAmount - amount,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: exp.expenseInvoicedDate || null,
        supplier: exp.supplierName || null,
        isRealised: cosRealised,
        noRevenueLinked: isNoRevLinked,
      });
    }

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdCOS = 0, ytdRevenue = 0, ytdRealisedCOS = 0, ytdRealisedRev = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const totalCOS = cosByMonth.get(monthKey) ?? 0;
      const realisedCOS = realisedCosByMonth.get(monthKey) ?? 0;
      const totalRevenue = revByMonth.get(monthKey) ?? 0;
      const realisedRevenue = realisedRevByMonth.get(monthKey) ?? 0;

      const totalGP = totalRevenue - totalCOS;
      const realisedGP = realisedRevenue - realisedCOS;
      const unrealisedGP = totalGP - realisedGP;
      const gpPct = totalRevenue !== 0 ? (totalGP / totalRevenue) * 100 : 0;

      ytdCOS += totalCOS;
      ytdRevenue += totalRevenue;
      ytdRealisedCOS += realisedCOS;
      ytdRealisedRev += realisedRevenue;
      const ytdGP = ytdRevenue - ytdCOS;
      const ytdRealisedGP = ytdRealisedRev - ytdRealisedCOS;
      const ytdUnrealisedGP = ytdGP - ytdRealisedGP;
      const ytdGpPct = ytdRevenue !== 0 ? (ytdGP / ytdRevenue) * 100 : 0;

      const monthItems = itemsByMonth.get(monthKey) || [];

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalRevenue,
        totalCOS,
        totalGP,
        realisedGP,
        unrealisedGP,
        gpPct,
        ytdRevenue,
        ytdCOS,
        ytdGP,
        ytdRealisedGP,
        ytdUnrealisedGP,
        ytdGpPct,
        itemCount: monthItems.length,
        realisedCount: monthItems.filter((it: any) => it.isRealised).length,
        items: monthItems,
      });
    }

    res.json({
      months,
      totalMilestoneRevenue,
      totalCOS: totalCOSAll,
    });
  } catch (error) {
    console.error("Project GP tracker error:", error);
    res.status(500).json({ error: "Failed to fetch project GP tracker data" });
  }
});

// GP Tracker — month detail drill-down (line-item level)
router.get("/api/gp-tracker/month-detail", requireAuth, async (req, res) => {
  try {
    const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const keyMatch = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!keyMatch) return res.status(400).json({ error: "Invalid monthKey format" });

    const [allExpenses, allInflowsRaw, cosOverrideMapGPD] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allExpenses, cosOverrideMapGPD);

    const revByProject = new Map<string, number>();
    for (const rev of allInflowsRaw) {
      const pName = normalizeProjectName(rev.projectName);
      const amt = parseFloat(rev.milestoneAmount as string) || 0;
      revByProject.set(pName, (revByProject.get(pName) || 0) + amt);
    }

    const cosByProject = new Map<string, number>();
    for (const exp of allExpenses) {
      const amount = parseExpenseAmount(exp);
      if (amount === 0) continue;
      const pName = normalizeProjectName(exp.projectName);
      cosByProject.set(pName, (cosByProject.get(pName) || 0) + amount);
    }

    const curMK = getCurrentMonthKey();
    const items: any[] = [];

    for (const exp of allExpenses) {
      const amount = parseExpenseAmount(exp);
      if (amount === 0) continue;

      const itemMonthKey = extractMonthKey(exp.expenseInvoicedDate as string | null);
      if (itemMonthKey !== monthKey) continue;

      const pName = normalizeProjectName(exp.projectName);
      if (project && pName !== project) continue;

      const totalCOSProject = cosByProject.get(pName) || 1;
      const totalRevProject = revByProject.get(pName) || 0;
      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      const revenueAmount = allocateRevenue(amount, totalCOSProject, totalRevProject, isNoRevLinked);
      const gpAmount = revenueAmount - amount;

      const cosRealised = isCosRealised(exp) && itemMonthKey <= curMK;
      const gpState = cosRealised ? 'Realised' : 'Unrealised';

      if (stateFilter && stateFilter.toLowerCase() !== gpState.toLowerCase()) continue;

      items.push({
        id: exp.id,
        projectName: pName,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        costAmount: amount,
        revenueAmount,
        gpAmount,
        gpPct: revenueAmount !== 0 ? (gpAmount / revenueAmount) * 100 : 0,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: exp.expenseInvoicedDate || null,
        supplier: exp.supplierName || null,
        isRealised: cosRealised,
        noRevenueLinked: isNoRevLinked,
        gpState,
      });
    }

    items.sort((a, b) => b.gpAmount - a.gpAmount);

    const realisedGP = items.filter(i => i.isRealised).reduce((s, i) => s + i.gpAmount, 0);
    const unrealisedGP = items.filter(i => !i.isRealised).reduce((s, i) => s + i.gpAmount, 0);

    res.json({
      monthKey,
      lineCount: items.length,
      totalRevenue: items.reduce((s, i) => s + i.revenueAmount, 0),
      totalCOS: items.reduce((s, i) => s + i.costAmount, 0),
      totalGP: items.reduce((s, i) => s + i.gpAmount, 0),
      realisedGP,
      unrealisedGP,
      items,
    });
  } catch (error) {
    console.error("GP tracker month-detail error:", error);
    res.status(500).json({ error: "Failed to fetch GP tracker month detail" });
  }
});

router.get("/api/revenue-tracker", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  try {
    const [allExpenses, allInflowsRaw, manualEntries, cosOverrideMap] = await Promise.all([
      storage.getAllProgramExpenses(),
      storage.getAllProgramInflows(),
      storage.getTrackerMonthlyManual('REV'),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allExpenses, cosOverrideMap);

    const manualBudgetMap = new Map(manualEntries.map(e => [e.monthKey, e]));

    const revenueByProject = new Map<string, number>();
    for (const inflow of allInflowsRaw) {
      const amt = parseFloat(inflow.milestoneAmount as string) || 0;
      if (amt === 0) continue;
      const pName = (inflow.projectName || '').replace(/_Tracker$/i, '');
      revenueByProject.set(pName, (revenueByProject.get(pName) || 0) + amt);
    }

    const cosByProject = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;
      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      cosByProject.set(pName, (cosByProject.get(pName) || 0) + amount);
    }

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    const revByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    const realisedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();

    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      const projectTotalCOS = cosByProject.get(pName) || 0;
      const projectTotalRevenue = revenueByProject.get(pName) || 0;
      const isNoRevLinked = !!(exp as any).noRevenueLinked;

      const revenueAmount = (projectTotalCOS > 0 && !isNoRevLinked)
        ? (amount / projectTotalCOS) * projectTotalRevenue
        : 0;

      if (!revByMonth.has(monthKey)) revByMonth.set(monthKey, { total: 0, projects: new Map() });
      const revBucket = revByMonth.get(monthKey)!;
      revBucket.total += revenueAmount;
      revBucket.projects.set(pName, (revBucket.projects.get(pName) || 0) + revenueAmount);

      const cosRealised = isCosRealised(exp) && monthKey <= currentMonthKey;
      if (cosRealised) {
        if (!realisedByMonth.has(monthKey)) realisedByMonth.set(monthKey, { total: 0, projects: new Map() });
        const realBucket = realisedByMonth.get(monthKey)!;
        realBucket.total += revenueAmount;
        realBucket.projects.set(pName, (realBucket.projects.get(pName) || 0) + revenueAmount);
      }
    }

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdRevenue = 0, ytdRealised = 0, ytdBudget = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const bucket = revByMonth.get(monthKey);
      const totalRevenue = bucket?.total ?? 0;

      const realisedBucket = realisedByMonth.get(monthKey);
      const realisedRevenue = realisedBucket?.total ?? 0;
      const unrealisedRevenue = totalRevenue - realisedRevenue;

      const manual = manualBudgetMap.get(monthKey);
      const budget = manual?.budget ? parseFloat(manual.budget) : 0;
      const variance = totalRevenue - budget;
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      ytdRevenue += totalRevenue;
      ytdRealised += realisedRevenue;
      ytdBudget += budget;
      const ytdUnrealised = ytdRevenue - ytdRealised;
      const ytdVariance = ytdRevenue - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalRevenue,
        realisedRevenue,
        unrealisedRevenue,
        budget,
        variance,
        variancePct,
        ytdRevenue,
        ytdRealised,
        ytdUnrealised,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        revProjects: mapToSortedArray(bucket?.projects ?? new Map()),
        realisedProjects: mapToSortedArray(realisedBucket?.projects ?? new Map()),
        unrealisedProjects: (() => {
          const revPs = bucket?.projects ?? new Map<string, number>();
          const realPs = realisedBucket?.projects ?? new Map<string, number>();
          const unrealMap = new Map<string, number>();
          revPs.forEach((v, k) => {
            const diff = v - (realPs.get(k) || 0);
            if (diff !== 0) unrealMap.set(k, diff);
          });
          return mapToSortedArray(unrealMap);
        })(),
      });
    }

    const totalMilestoneRevenue = Array.from(revenueByProject.values()).reduce((s, v) => s + v, 0);
    const totalCOS = Array.from(cosByProject.values()).reduce((s, v) => s + v, 0);

    res.json({
      months,
      totalMilestoneRevenue,
      totalCOS,
    });
  } catch (error) {
    console.error("Revenue tracker error:", error);
    res.status(500).json({ error: "Failed to fetch revenue tracker data" });
  }
});

router.get("/api/revenue-tracker/month-detail", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  try {
    const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const [allExpenses, cosOverrideMapRMD] = await Promise.all([
      project ? storage.getProgramExpensesByProject(project) : storage.getAllProgramExpenses(),
      loadCosOverrides(),
    ]);
    enrichWithOverrides(allExpenses, cosOverrideMapRMD);

    const allInflowsRaw = project
      ? await storage.getProgramInflowsByProject(project)
      : await storage.getAllProgramInflows();

    const revenueByProject = new Map<string, number>();
    for (const inflow of allInflowsRaw) {
      const amt = parseFloat(inflow.milestoneAmount as string) || 0;
      if (amt === 0) continue;
      const pName = (inflow.projectName || '').replace(/_Tracker$/i, '');
      revenueByProject.set(pName, (revenueByProject.get(pName) || 0) + amt);
    }

    const cosByProject = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;
      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      cosByProject.set(pName, (cosByProject.get(pName) || 0) + amount);
    }

    const nowDate = new Date();
    const currentMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    const items: any[] = [];
    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const invDate = exp.expenseInvoicedDate as string | null;
      if (!invDate) continue;
      const dateMatch = invDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const itemMonthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      if (itemMonthKey !== monthKey) continue;

      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      const projectTotalCOS = cosByProject.get(pName) || 0;
      const projectTotalRevenue = revenueByProject.get(pName) || 0;
      const isNoRevLinked = !!(exp as any).noRevenueLinked;

      const revenueAmount = (projectTotalCOS > 0 && !isNoRevLinked)
        ? (amount / projectTotalCOS) * projectTotalRevenue
        : 0;

      const cosRealised = isCosRealised(exp) && itemMonthKey <= currentMonthKey;
      const revState = cosRealised ? 'Realised' : 'Unrealised';

      if (stateFilter && stateFilter.toLowerCase() !== revState.toLowerCase()) continue;

      items.push({
        id: exp.id,
        projectName: pName,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        costAmount: amount,
        revenueAmount,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: exp.expenseInvoicedDate || null,
        supplier: exp.supplierName || null,
        isRealised: cosRealised,
        noRevenueLinked: isNoRevLinked,
        revState,
      });
    }

    res.json(items);
  } catch (error) {
    console.error("Revenue tracker month-detail error:", error);
    res.status(500).json({ error: "Failed to fetch revenue tracker month detail" });
  }
});

// ==================== BUDGETS CRUD ====================

router.get("/api/budgets", requireAuth, async (req, res) => {
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

router.get("/api/program-expenses", requireAuth, async (req, res) => {
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

router.get("/api/program-expenses/:projectName", requireAuth, async (req, res) => {
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

router.get("/api/program-inflows", requireAuth, async (req, res) => {
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

router.get("/api/cashflow", requireAuth, async (req, res) => {
  try {
    const projectParam = req.query.project || req.query.projectName;
    const { startDate, endDate } = req.query;
    const projectName = (projectParam && typeof projectParam === 'string') ? projectParam : null;

    if (!projectName) {
      return res.status(400).json({
        error: "Project filter required",
        message: "Please select a specific project to view cashflow data. The full portfolio cashflow is available in the Cashflow 2026 view.",
        hint: "Add ?project=ProjectName to filter by project"
      });
    }

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

router.get("/api/cashflow/planning-overrides", requireAuth, async (req, res) => {
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

router.get("/api/revenue-tracking/overrides", requireAuth, async (req, res) => {
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
    const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))];
    const baselineRowsByProject = new Map<string, Map<number, any>>();

    for (const projectName of projectNames) {
      const [rawInflows, existingOverrides] = await Promise.all([
        storage.getProgramInflowsByProject(projectName),
        storage.getRevenueTrackingOverridesByProject(projectName),
      ]);
      const currentRows = applyRevenueTrackingOverrides(rawInflows, existingOverrides);
      baselineRowsByProject.set(
        projectName,
        new Map(currentRows.map((row: any) => [row.rowNumber, row])),
      );
    }

    const saved = await storage.upsertManyRevenueTrackingOverrides(overridesWithUser);

    try {
      for (const projectName of projectNames) {
        const [rawInflows, latestOverrides] = await Promise.all([
          storage.getProgramInflowsByProject(projectName),
          storage.getRevenueTrackingOverridesByProject(projectName),
        ]);
        const appliedRows = applyRevenueTrackingOverrides(rawInflows, latestOverrides);
        for (const r of appliedRows) {
          const milestoneNo = r.milestoneNo;
          if (!milestoneNo || !/^\d+$/.test(String(milestoneNo).trim())) continue;
          const rowNum = r.rowNumber;
          if (!rowNum) continue;
          const manualInBank = r.inBank === 1 || r.inBank === '1' || r.inBank === true;
          const hasInvoice = !!(r.milestoneInvoiceNumber && String(r.milestoneInvoiceNumber).trim());
          const hasPaymentReceived = !!(r.paymentReceivedDate && String(r.paymentReceivedDate).trim() && r.paymentReceivedDate !== '-');
          const isInBank = manualInBank || (hasPaymentReceived && hasInvoice);
          const paidDateConfirmed = isInBank;
          const paidDateFontColor = isInBank ? 'black' : 'red';
          const paidDate = isInBank ? (r.paymentReceivedDate || r.plannedPaymentDate || null) : null;
          await db.update(normalizedRevenueLines)
            .set({
              paidDateConfirmed,
              paidDateFontColor,
              paidDate: paidDate,
              inBankDate: isInBank ? (paidDate || null) : null,
            })
            .where(
              and(
                eq(normalizedRevenueLines.projectName, projectName),
                eq(normalizedRevenueLines.sourceRow, rowNum),
              )
            );
        }
      }
    } catch (syncErr: any) {
      console.warn("[sync] Revenue inBank sync to normalized_revenue_lines failed:", syncErr.message);
    }

    try {
      for (const o of overrides) {
        const baselineRow = baselineRowsByProject.get(o.projectName)?.get(o.rowNumber);
        const previousValue = baselineRow ? baselineRow[o.fieldName] : null;
        await recordOverride({
          actorUserId: userId,
          actorRole: (req as any).user?.role,
          entityType: "revenue_tracking_override",
          entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
          projectName: o.projectName,
          action: "REVENUE_OVERRIDE",
          overrideCategory,
          overrideComment: overrideComment.trim(),
          oldRecord: { [o.fieldName]: previousValue },
          newRecord: { [o.fieldName]: normalizeOverrideValue(o.overrideValue) },
        });
      }
    } catch (auditErr: any) {
      console.warn("[audit] Revenue override audit failed:", auditErr.message);
    }

    res.json({ message: "Revenue tracking overrides saved", count: saved.length, overrides: saved });

    // Prompt 12: Refresh materialized dashboard metrics for affected projects
    try {
      const allProjectInfoRows = await storage.getAllProjectInfo();
      const nameToId = new Map(allProjectInfoRows.map((p: any) => [p.projectName, p.id]));
      for (const pn of projectNames) {
        const pid = nameToId.get(pn);
        if (pid) refreshProjectMetricsAsync(pid);
      }
    } catch (_) { /* non-blocking */ }
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

router.get("/api/revenue-tab/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = req.params.projectName;

    const useCanonical = await isWorkItemsEnabled();
    const [rawInflows, overrides, projectInfoList, savedSummary, canonicalTasks, legacyOperationalTasks, planTasks, taskLinks] = await Promise.all([
      storage.getProgramInflowsByProject(projectName),
      storage.getRevenueTrackingOverridesByProject(projectName),
      storage.getAllProjectInfo(),
      storage.getProjectRevenueSummary(projectName),
      useCanonical ? getWorkItemsAsOperationalTasks(projectName) : Promise.resolve([]),
      storage.getOperationalTasksByProject(projectName),
      storage.getProjectPlansByProject(projectName),
      storage.getMilestoneTaskLinks(projectName),
    ]);
    const operationalTasks = (useCanonical && canonicalTasks.length > 0) ? canonicalTasks : legacyOperationalTasks;

    const inflows = applyRevenueTrackingOverrides(rawInflows, overrides);
    const sourceInflowByRow = new Map(rawInflows.map((row: any) => [row.rowNumber, row]));
    const overrideByFieldKey = new Map(overrides.map((row: any) => [`${row.rowNumber}|${row.fieldName}`, row]));
    const taskLinkByRow = new Map(taskLinks.map((row: any) => [row.milestoneRowNumber, row]));

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
    const pInfo = projectInfoList.find((p: any) => p.projectName === projectName);
    const contractValue = pInfo ? parseFloat(String(pInfo.contractValue || '0')) : 0;
    const governance = await loadProjectFinanceGovernanceContext(
      projectName,
      (pInfo as any)?.id ?? null,
      overrides
        .map((row: any) => row.createdBy)
        .filter((id: any): id is number => typeof id === "number" && Number.isFinite(id))
    );

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

      if (inBank && hasInvoice) {
        status = 'inBank';
      } else if (hasPaymentReceived && hasInvoice) {
        status = 'received';
        flags.push('Payment received, pending bank confirmation');
      } else if (hasInvoice) {
        status = 'invoiced';
        flags.push('Invoice raised, payment outstanding');
      } else if (!hasInvoice && isPast) {
        status = 'overdue';
        flags.push('Payment date has passed without invoice');
      } else {
        status = 'planned';
      }

      const hasOverride = overrides.some((o: any) => o.rowNumber === r.rowNumber);

      const link = taskLinkByRow.get(r.rowNumber);
      let linkedTask: any = null;
      if (link) {
        if (link.taskId > 0) {
          linkedTask = operationalTasks.find((t: any) => t.id === link.taskId)
            || legacyOperationalTasks.find((t: any) => t.id === link.taskId);
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

      const sourceRow = sourceInflowByRow.get(r.rowNumber) || r;
      const taskLinkChange = governance.latestChangeByEntity.get(`${projectName}|milestone${r.rowNumber}|task-link`);
      const dateOverrideChange = governance.latestChangeByEntity.get(`${projectName}|milestone${r.rowNumber}|date-override`);
      const fieldAudits = {
        milestoneAmount: buildRevenueFieldAudit(
          projectName,
          r.rowNumber,
          "milestoneAmount",
          sourceRow?.milestoneAmount ?? null,
          r.milestoneAmount,
          overrideByFieldKey.get(`${r.rowNumber}|milestoneAmount`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        plannedPaymentDate: buildRevenueFieldAudit(
          projectName,
          r.rowNumber,
          "plannedPaymentDate",
          sourceRow?.plannedPaymentDate ?? null,
          r.plannedPaymentDate,
          overrideByFieldKey.get(`${r.rowNumber}|plannedPaymentDate`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        milestoneInvoiceNumber: buildRevenueFieldAudit(
          projectName,
          r.rowNumber,
          "milestoneInvoiceNumber",
          sourceRow?.milestoneInvoiceNumber ?? null,
          r.milestoneInvoiceNumber,
          overrideByFieldKey.get(`${r.rowNumber}|milestoneInvoiceNumber`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        invoiceRaisedDate: buildRevenueFieldAudit(
          projectName,
          r.rowNumber,
          "invoiceRaisedDate",
          sourceRow?.invoiceRaisedDate ?? null,
          r.invoiceRaisedDate,
          overrideByFieldKey.get(`${r.rowNumber}|invoiceRaisedDate`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        inBank: buildRevenueFieldAudit(
          projectName,
          r.rowNumber,
          "inBank",
          sourceRow?.inBank ?? 0,
          r.inBank,
          overrideByFieldKey.get(`${r.rowNumber}|inBank`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        paymentReceivedDate: buildRevenueFieldAudit(
          projectName,
          r.rowNumber,
          "paymentReceivedDate",
          sourceRow?.paymentReceivedDate ?? null,
          r.paymentReceivedDate,
          overrideByFieldKey.get(`${r.rowNumber}|paymentReceivedDate`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
      };
      const editedFields = Object.values(fieldAudits)
        .filter((audit) => auditValuesDiffer(audit.sourceValue, audit.managedValue) || audit.overrideValue !== null || audit.overrideComment)
        .map((audit) => audit.fieldName);
      const latestFieldAudit = Object.values(fieldAudits).reduce((latest: any, audit: any) => {
        if (!audit.changedAt) return latest;
        if (!latest?.changedAt) return audit;
        return new Date(audit.changedAt).getTime() > new Date(latest.changedAt).getTime() ? audit : latest;
      }, null);
      const taskLinkChangedByName = formatChangeUserName(taskLinkChange?.actorUserId, taskLinkChange?.actorRole, governance.userNameById);
      const dateOverrideChangedByName = formatChangeUserName(dateOverrideChange?.actorUserId, dateOverrideChange?.actorRole, governance.userNameById);
      const lastChangedAt = [
        latestFieldAudit?.changedAt,
        taskLinkChange?.createdAt,
        dateOverrideChange?.createdAt,
      ]
        .filter(Boolean)
        .sort((left, right) => new Date(String(right)).getTime() - new Date(String(left)).getTime())[0] || null;
      const lastChangedByName = latestFieldAudit?.changedByName || dateOverrideChangedByName || taskLinkChangedByName || null;

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
        trust: {
          sourceSheet: "Revenue Tracking",
          sourceRow: sourceRow?.rowNumber ?? r.rowNumber,
          hasVariance: editedFields.length > 0 || !!link?.dateOverride,
          editedFields,
          lastChangedAt,
          lastChangedByName,
          taskLink: link
            ? {
                taskId: link.taskId,
                changedAt: taskLinkChange?.createdAt || null,
                changedByName: taskLinkChangedByName,
              }
            : null,
          dateOverrideChange: link?.dateOverride
            ? {
                dateOverride: link.dateOverride,
                reason: link.dateOverrideReason || null,
                changedAt: dateOverrideChange?.createdAt || null,
                changedByName: dateOverrideChangedByName,
              }
            : null,
          fieldAudits,
        },
      };
    });

    const totalContract = milestones.reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const invoiced = milestones.filter((m: any) => m.status === 'invoiced').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const inBankTotal = milestones.filter((m: any) => m.status === 'inBank').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const pending = milestones.filter((m: any) => m.status === 'planned' || m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const overdueTotal = milestones.filter((m: any) => m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);

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
    const actualProfit = actualRevenue - allExpenditure;
    const actualMargin = actualRevenue > 0 ? actualProfit / actualRevenue : 0;

    const liveRevenue = totalContract;
    const liveExpenditure = allExpenditure;
    const liveProfit = liveRevenue - liveExpenditure;
    const liveMargin = liveRevenue > 0 ? liveProfit / liveRevenue : 0;
    const costedChange = governance.latestChangeByEntity.get(`${projectName}|costed`);
    const costedChangedByName = formatChangeUserName(costedChange?.actorUserId, costedChange?.actorRole, governance.userNameById);
    const overriddenMilestoneCount = new Set(overrides.map((row: any) => row.rowNumber)).size;
    const overriddenFieldCount = new Set(overrides.map((row: any) => `${row.rowNumber}:${row.fieldName}`)).size;
    const unlinkedMilestones = milestones.filter((milestone: any) => !milestone.dependentTask);
    const riskSignals = [
      overdueTotal > 0
        ? {
            key: "overdue_revenue",
            severity: "warning",
            label: "Overdue revenue exposure",
            amount: overdueTotal,
            count: milestones.filter((milestone: any) => milestone.status === "overdue").length,
            detail: "Milestones are past planned dates without invoice confirmation.",
          }
        : null,
      pending > 0
        ? {
            key: "cash_exposure",
            severity: "info",
            label: "Unbanked revenue exposure",
            amount: totalContract - inBankTotal,
            count: milestones.filter((milestone: any) => milestone.status !== "inBank").length,
            detail: "Contract value not yet confirmed in bank.",
          }
        : null,
      unlinkedMilestones.length > 0
        ? {
            key: "unlinked_milestones",
            severity: "info",
            label: "Milestones missing task linkage",
            amount: unlinkedMilestones.reduce((sum: number, milestone: any) => sum + safeNum(milestone.milestoneAmount), 0),
            count: unlinkedMilestones.length,
            detail: "Milestones should stay linked to project execution items for commercial traceability.",
          }
        : null,
      governance.approvals.affectingCashCount > 0
        ? {
            key: "cash_approvals",
            severity: "warning",
            label: "Approvals affecting cash",
            count: governance.approvals.affectingCashCount,
            detail: "Pending approvals may change invoices, revenue timing, or commercial flow.",
          }
        : null,
      governance.editRequests.pendingCount > 0
        ? {
            key: "pending_edits",
            severity: "info",
            label: "Pending finance edit requests",
            count: governance.editRequests.pendingCount,
            detail: "Awaiting approval before managed finance truth changes.",
          }
        : null,
      governance.microsoft.actionRequiredCount > 0
        ? {
            key: "microsoft_actions",
            severity: "info",
            label: "Linked Microsoft items need action",
            count: governance.microsoft.actionRequiredCount,
            detail: "Project-linked communications or meetings flagged for action.",
          }
        : null,
      actualMargin < plannedMargin
        ? {
            key: "margin_pressure",
            severity: "warning",
            label: "Margin pressure",
            amount: actualProfit - plannedProfit,
            detail: "Actual margin is below the current costed margin.",
          }
        : null,
    ].filter(Boolean);

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
          trust: {
            sourceRevenue: totalContract,
            managedRevenue: plannedRevenue,
            revenueVariance: plannedRevenue - totalContract,
            sourceExpenditure: costedExpenditure,
            managedExpenditure: costedExpenditureFinal,
            expenditureVariance: costedExpenditureFinal - costedExpenditure,
            changedAt: costedChange?.createdAt || null,
            changedByName: costedChangedByName,
            overrideCategory: costedChange?.overrideCategory || null,
            overrideComment: costedChange?.overrideComment || null,
          },
        },
        planned: {
          revenue: liveRevenue,
          expenditure: liveExpenditure,
          profit: liveProfit,
          margin: liveMargin,
        },
        actual: {
          revenue: actualRevenue,
          expenditure: allExpenditure,
          profit: actualProfit,
          margin: actualMargin,
        },
        voPmLimit: null,
        currentVoTotal: null,
      },
      reconciliation: {
        source: {
          sourceSheet: "Revenue Tracking",
          milestoneCount: milestones.length,
          importedContractValue: totalContract,
          projectContractValue: contractValue,
        },
        managed: {
          overriddenMilestoneCount,
          overriddenFieldCount,
          manualCostedOverride: !!savedSummary?.plannedRevenue || !!savedSummary?.plannedExpenditure,
          latestChangeAt: governance.recentChanges[0]?.createdAt || null,
          latestChangeByName: governance.recentChanges[0]?.actorName || null,
        },
        variances: {
          projectContractVsImported: contractValue - totalContract,
          costedRevenueVsImported: plannedRevenue - totalContract,
          costedExpenditureVsImportedBudget: costedExpenditureFinal - costedExpenditure,
          actualMarginVsCostedMargin: actualMargin - plannedMargin,
          liveMarginVsCostedMargin: liveMargin - plannedMargin,
          overdueExposure: overdueTotal,
          unbankedExposure: totalContract - inBankTotal,
          unlinkedMilestones: unlinkedMilestones.length,
        },
        approvals: governance.approvals,
        editRequests: governance.editRequests,
        microsoft: governance.microsoft,
        recentChanges: governance.recentChanges,
      },
      riskSignals,
    });
  } catch (error) {
    console.error("Revenue tab error:", error);
    res.status(500).json({ error: "Failed to fetch revenue tab data" });
  }
});

router.post("/api/revenue-tab/:projectName/costed", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const projectName = String(req.params.projectName || "");
    const { revenue, expenditure, changeReason, changeCategory } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const existingSummary = await storage.getProjectRevenueSummary(projectName);
    const auditComment = typeof changeReason === "string" && changeReason.trim().length >= 3
      ? changeReason.trim()
      : "Costed values adjusted from the project revenue workspace";
    const auditCategory = typeof changeCategory === "string" && (OVERRIDE_CATEGORIES as readonly string[]).includes(changeCategory)
      ? (changeCategory as (typeof OVERRIDE_CATEGORIES)[number])
      : "RECONCILIATION";

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

    try {
      await recordOverride({
        actorUserId: userId,
        actorRole: userRole,
        entityType: "project_revenue_summary",
        entityId: `${projectName}|costed`,
        projectName,
        action: "PROJECT_REVENUE_SUMMARY_OVERRIDE",
        overrideCategory: auditCategory,
        overrideComment: auditComment,
        oldRecord: {
          plannedRevenue: existingSummary?.plannedRevenue ?? null,
          plannedExpenditure: existingSummary?.plannedExpenditure ?? null,
          plannedProfit: existingSummary?.plannedProfit ?? null,
          plannedMargin: existingSummary?.plannedMargin ?? null,
        },
        newRecord: {
          plannedRevenue: revenue?.toString() ?? null,
          plannedExpenditure: expenditure?.toString() ?? null,
          plannedProfit: (revenue && expenditure) ? (parseFloat(revenue) - parseFloat(expenditure)).toString() : null,
          plannedMargin: (revenue && expenditure && parseFloat(revenue) > 0) ? ((parseFloat(revenue) - parseFloat(expenditure)) / parseFloat(revenue)).toString() : null,
        },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Costed values audit failed:", auditErr.message);
    }

    res.json(saved);
  } catch (error) {
    console.error("Save costed error:", error);
    res.status(500).json({ error: "Failed to save costed values" });
  }
});

router.get("/api/revenue-tab/:projectName/task-alerts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const useCanonicalAlerts = await isWorkItemsEnabled();
    const [legacyTasks, canonicalAlertTasks, inflows, taskLinks] = await Promise.all([
      storage.getOperationalTasksByProject(projectName),
      useCanonicalAlerts ? getWorkItemsAsOperationalTasks(projectName) : Promise.resolve([]),
      storage.getProgramInflowsByProject(projectName),
      storage.getMilestoneTaskLinks(projectName),
    ]);
    const tasks = (useCanonicalAlerts && canonicalAlertTasks.length > 0) ? canonicalAlertTasks : legacyTasks;

    const alerts: any[] = [];
    for (const milestone of inflows) {
      if (!milestone.milestoneNo || !/^\d+$/.test(String(milestone.milestoneNo).trim())) continue;
      const name = (milestone.milestoneName || '').trim();
      if (name === '-') continue;

      const link = taskLinks.find((l: any) => l.milestoneRowNumber === milestone.rowNumber);
      const linkedTask = link ? (tasks.find((t: any) => t.id === link.taskId) || legacyTasks.find((t: any) => t.id === link.taskId)) : null;

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

    const existingLinks = await storage.getMilestoneTaskLinks(projectName);
    const previousLink = existingLinks.find((link: any) => link.milestoneRowNumber === milestoneRowNumber);
    const link = await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, taskId);

    try {
      await recordOverride({
        actorUserId: userId,
        actorRole: userRole,
        entityType: "milestone_task_link",
        entityId: `${projectName}|milestone${milestoneRowNumber}|task`,
        projectName,
        action: "MILESTONE_TASK_LINK",
        overrideCategory: "DATA_CORRECTION",
        overrideComment: `Linked milestone ${milestoneRowNumber} to task ${taskId}`,
        oldRecord: {
          taskId: previousLink?.taskId ?? null,
          dateOverride: previousLink?.dateOverride ?? null,
          dateOverrideReason: previousLink?.dateOverrideReason ?? null,
        },
        newRecord: {
          taskId,
          dateOverride: previousLink?.dateOverride ?? null,
          dateOverrideReason: previousLink?.dateOverrideReason ?? null,
        },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Milestone task link audit failed:", auditErr.message);
    }

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
    const previousState = {
      taskId: link?.taskId ?? 0,
      dateOverride: link?.dateOverride ?? null,
      dateOverrideReason: link?.dateOverrideReason ?? null,
    };

    if (link) {
      const updated = await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, link.taskId);
      await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
    } else {
      await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, 0);
      await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
    }

    try {
      await recordOverride({
        actorUserId: (req as any).user?.id,
        actorRole: (req as any).user?.role,
        entityType: "milestone_date_override",
        entityId: `${projectName}|milestone${milestoneRowNumber}|date`,
        projectName,
        action: "MILESTONE_DATE_OVERRIDE",
        overrideCategory: "TIMING_ADJUSTMENT",
        overrideComment: reason?.trim() || "Revenue date override applied",
        oldRecord: previousState,
        newRecord: {
          taskId: previousState.taskId,
          dateOverride,
          dateOverrideReason: reason || null,
        },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Milestone date override audit failed:", auditErr.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Date override error:", error);
    res.status(500).json({ error: "Failed to save date override" });
  }
});

router.delete("/api/revenue-tab/:projectName/link-task/:milestoneRowNumber", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const milestoneRowNumber = parseInt(req.params.milestoneRowNumber);
    const existingLinks = await storage.getMilestoneTaskLinks(projectName);
    const previousLink = existingLinks.find((link: any) => link.milestoneRowNumber === milestoneRowNumber);
    await storage.deleteMilestoneTaskLink(projectName, milestoneRowNumber);

    try {
      await recordOverride({
        actorUserId: (req as any).user?.id,
        actorRole: (req as any).user?.role,
        entityType: "milestone_task_link",
        entityId: `${projectName}|milestone${milestoneRowNumber}|task`,
        projectName,
        action: "MILESTONE_TASK_UNLINK",
        overrideCategory: "DATA_CORRECTION",
        overrideComment: `Unlinked milestone ${milestoneRowNumber} from task`,
        oldRecord: {
          taskId: previousLink?.taskId ?? null,
          dateOverride: previousLink?.dateOverride ?? null,
          dateOverrideReason: previousLink?.dateOverrideReason ?? null,
        },
        newRecord: {
          taskId: null,
          dateOverride: null,
          dateOverrideReason: null,
        },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Milestone task unlink audit failed:", auditErr.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unlink task error:", error);
    res.status(500).json({ error: "Failed to unlink task" });
  }
});

// ==================== EXPENDITURE OVERRIDES ====================

router.get("/api/expenditure/overrides", requireAuth, async (req, res) => {
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
      supplierName: "supplierName",
    };

    const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
    const baselineExpenseRowsByProject = new Map<string, Map<number, any>>();
    for (const pn of projectNames) {
      const expenses = await storage.getProgramExpensesByProject(pn as string);
      baselineExpenseRowsByProject.set(
        pn as string,
        new Map(expenses.map((expense: any) => [expense.rowNumber, expense])),
      );
    }

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
          oldRecord: { [o.fieldName]: baselineExpenseRowsByProject.get(o.projectName)?.get(o.rowNumber)?.[o.fieldName] ?? null },
          newRecord: { [o.fieldName]: normalizeOverrideValue(o.overrideValue) },
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

    try {
      await recordOverride({
        actorUserId: (req as any).user?.id,
        actorRole: (req as any).user?.role,
        entityType: "expense_task_link",
        entityId: `${req.params.projectName}|expense${expenseId}`,
        projectName: decodeURIComponent(req.params.projectName),
        action: "EXPENSE_TASK_LINK",
        overrideCategory: "DATA_CORRECTION",
        overrideComment: `Linked expense ${expenseId} to task ${taskId}`,
        oldRecord: {},
        newRecord: { expenseId, taskId },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Expense task link audit failed:", auditErr.message);
    }

    res.json(link);
  } catch (error) {
    console.error("Link expense task error:", error);
    res.status(500).json({ error: "Failed to link task" });
  }
});

router.delete("/api/expense-task-links/:projectName/:expenseId", requireAuth, requireAdminOrFinancialEditor, async (req, res) => {
  try {
    const expenseId = parseInt(req.params.expenseId);
    await storage.deleteExpenseTaskLink(req.params.projectName, expenseId);

    try {
      await recordOverride({
        actorUserId: (req as any).user?.id,
        actorRole: (req as any).user?.role,
        entityType: "expense_task_link",
        entityId: `${req.params.projectName}|expense${expenseId}`,
        projectName: decodeURIComponent(req.params.projectName),
        action: "EXPENSE_TASK_UNLINK",
        overrideCategory: "DATA_CORRECTION",
        overrideComment: `Unlinked expense ${expenseId} from task`,
        oldRecord: { expenseId },
        newRecord: {},
      });
    } catch (auditErr: any) {
      console.warn("[audit] Expense task unlink audit failed:", auditErr.message);
    }

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
    const [expenses, taskLinks, opTasks, planTasks, cosOverrides, expenditureOverrides, projectRows, revSummary] = await Promise.all([
      storage.getProgramExpensesByProject(projectName),
      storage.getExpenseTaskLinks(projectName),
      storage.getOperationalTasksByProject(projectName),
      storage.getProjectPlansByProject(projectName),
      db.select().from(cosStatusOverrides).where(eq(cosStatusOverrides.projectName, projectName)),
      storage.getExpenditureOverridesByProject(projectName),
      db
        .select({
          id: projectInfo.id,
          projectName: projectInfo.projectName,
        })
        .from(projectInfo)
        .where(eq(projectInfo.projectName, projectName))
        .limit(1),
      storage.getProjectRevenueSummary(projectName),
    ]);

    const cosOverrideByExpenseId = new Map(cosOverrides.map(o => [o.expenseId, o]));
    const cosOverrideByRow = new Map(cosOverrides.map(o => [`${o.projectName}:${o.rowNumber}`, o]));
    const overrideByFieldKey = new Map(expenditureOverrides.map((row: any) => [`${row.rowNumber}|${row.fieldName}`, row]));
    const governance = await loadProjectFinanceGovernanceContext(
      projectName,
      projectRows[0]?.id ?? null,
      expenditureOverrides
        .map((row: any) => row.createdBy)
        .filter((id: any): id is number => typeof id === "number" && Number.isFinite(id))
    );

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

      const invDateConfirmed = hasInvDate && isDateConfirmed(exp.invoiceDateConfirmed, exp.invoiceDateFontColor);
      let cosStatus: string;
      if (hasInvoice && hasInvDate && invDateConfirmed) {
        cosStatus = 'COS Realised';
      } else if (hasPO || hasInvoice) {
        cosStatus = 'Committed';
      } else {
        cosStatus = 'Planned';
      }

      const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
      const paymentDateBlack = hasPayDate && isDateConfirmed(exp.paymentDateConfirmed, exp.paymentDateFontColor);

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

      const cosOverride = (cosOverrideByExpenseId.get(exp.id) || cosOverrideByRow.get(`${exp.projectName}:${exp.rowNumber}`)) as any;
      const fieldAudits = {
        budgetTotal: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "budgetTotal",
          exp.budgetTotal,
          overrideByFieldKey.get(`${exp.rowNumber}|budgetTotal`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        expenseActualTotal: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "expenseActualTotal",
          exp.expenseActualTotal,
          overrideByFieldKey.get(`${exp.rowNumber}|expenseActualTotal`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        expensePoNumber: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "expensePoNumber",
          exp.expensePoNumber,
          overrideByFieldKey.get(`${exp.rowNumber}|expensePoNumber`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        expenseInvoiceNumber: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "expenseInvoiceNumber",
          exp.expenseInvoiceNumber,
          overrideByFieldKey.get(`${exp.rowNumber}|expenseInvoiceNumber`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        expenseInvoicedDate: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "expenseInvoicedDate",
          exp.expenseInvoicedDate,
          overrideByFieldKey.get(`${exp.rowNumber}|expenseInvoicedDate`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        expensePaymentDate: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "expensePaymentDate",
          exp.expensePaymentDate,
          overrideByFieldKey.get(`${exp.rowNumber}|expensePaymentDate`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
        supplierName: buildExpenditureFieldAudit(
          projectName,
          exp.rowNumber,
          "supplierName",
          (exp as any).supplierName ?? null,
          overrideByFieldKey.get(`${exp.rowNumber}|supplierName`),
          governance.latestChangeByEntity,
          governance.userNameById,
        ),
      };
      const editedFields = Object.values(fieldAudits)
        .filter((audit) => auditValuesDiffer(audit.sourceValue, audit.managedValue) || audit.overrideValue !== null || audit.overrideComment)
        .map((audit) => audit.fieldName);
      const latestFieldAudit = Object.values(fieldAudits).reduce((latest: any, audit: any) => {
        if (!audit.changedAt) return latest;
        if (!latest?.changedAt) return audit;
        return new Date(audit.changedAt).getTime() > new Date(latest.changedAt).getTime() ? audit : latest;
      }, null);

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
        trust: {
          sourceSheet: "Expenditure Breakdown",
          sourceRow: exp.rowNumber,
          hasVariance: editedFields.length > 0 || !!cosOverride || !!link?.dateOverride,
          editedFields,
          lastChangedAt: latestFieldAudit?.changedAt || null,
          lastChangedByName: latestFieldAudit?.changedByName || cosOverride?.overriddenBy || null,
          fieldAudits,
        },
      };
    });

    const categories = [...new Set(expenses.filter((e: any) => e.rowType === 'category').map((e: any) => e.expenseCategory).filter(Boolean))];

    const importedBudgetRaw = enriched.reduce((sum: number, item: any) => sum + safeNum(item.budgetTotal), 0);
    const costedExpenditure = safeNum(revSummary?.plannedExpenditure);
    if (costedExpenditure > 0 && importedBudgetRaw === 0) {
      const totalAct = enriched.reduce((s: number, e: any) => s + safeNum(e.expenseActualTotal), 0);
      if (totalAct > 0) {
        let allocated = 0;
        for (let i = 0; i < enriched.length; i++) {
          const actual = safeNum(enriched[i].expenseActualTotal);
          if (i === enriched.length - 1) {
            (enriched[i] as any).budgetTotal = (costedExpenditure - allocated).toFixed(2);
          } else {
            const share = Math.round((actual / totalAct) * costedExpenditure * 100) / 100;
            (enriched[i] as any).budgetTotal = share.toFixed(2);
            allocated += share;
          }
          (enriched[i] as any)._budgetFromCosted = true;
        }
      }
    }

    const totalBudget = enriched.reduce((sum: number, item: any) => sum + safeNum(item.budgetTotal), 0);
    const totalActual = enriched.reduce((sum: number, item: any) => sum + safeNum(item.expenseActualTotal), 0);
    const realisedCos = enriched
      .filter((item: any) => item.cosStatus === "COS Realised")
      .reduce((sum: number, item: any) => sum + safeNum(item.expenseActualTotal), 0);
    const outOfBankTotal = enriched
      .filter((item: any) => item.paymentStatus === "Out of Bank")
      .reduce((sum: number, item: any) => sum + safeNum(item.expenseActualTotal), 0);
    const committedUnpaidTotal = enriched
      .filter((item: any) => item.cosStatus === "Committed" && item.paymentStatus !== "Out of Bank")
      .reduce((sum: number, item: any) => sum + safeNum(item.expenseActualTotal), 0);
    const overriddenRowCount = new Set(expenditureOverrides.map((row: any) => row.rowNumber)).size;
    const overriddenFieldCount = new Set(expenditureOverrides.map((row: any) => `${row.rowNumber}:${row.fieldName}`)).size;
    const noRevenueLinkedCount = enriched.filter((item: any) => item.noRevenueLinked).length;
    const overBudgetItems = enriched.filter((item: any) => safeNum(item.expenseActualTotal) > safeNum(item.budgetTotal));
    const riskSignals = [
      totalActual > totalBudget
        ? {
            key: "budget_overrun",
            severity: "warning",
            label: "Expenditure above budget",
            amount: totalActual - totalBudget,
            count: overBudgetItems.length,
            detail: "Actual or managed expenditure exceeds imported budget.",
          }
        : null,
      committedUnpaidTotal > 0
        ? {
            key: "committed_unpaid",
            severity: "info",
            label: "Committed supplier exposure",
            amount: committedUnpaidTotal,
            count: enriched.filter((item: any) => item.cosStatus === "Committed" && item.paymentStatus !== "Out of Bank").length,
            detail: "Committed cost not yet out of bank.",
          }
        : null,
      noRevenueLinkedCount > 0
        ? {
            key: "no_revenue_linked",
            severity: "info",
            label: "Cost lines excluded from revenue linkage",
            count: noRevenueLinkedCount,
            detail: "Review whether these lines should remain outside revenue linkage.",
          }
        : null,
      governance.approvals.affectingCashCount > 0
        ? {
            key: "cash_approvals",
            severity: "warning",
            label: "Approvals affecting cash",
            count: governance.approvals.affectingCashCount,
            detail: "Pending approvals may alter payment timing or cost recognition.",
          }
        : null,
      governance.editRequests.pendingCount > 0
        ? {
            key: "pending_edits",
            severity: "info",
            label: "Pending finance edit requests",
            count: governance.editRequests.pendingCount,
            detail: "Approval queue still holds finance changes for this project.",
          }
        : null,
      governance.microsoft.actionRequiredCount > 0
        ? {
            key: "microsoft_actions",
            severity: "info",
            label: "Linked Microsoft items need action",
            count: governance.microsoft.actionRequiredCount,
            detail: "Commercial communications or meetings on this project still need follow-up.",
          }
        : null,
    ].filter(Boolean);

    res.json({
      items: enriched,
      categories,
      reconciliation: {
        source: {
          sourceSheet: "Expenditure Breakdown",
          itemCount: enriched.length,
          importedBudget: importedBudgetRaw,
          allocatedBudget: totalBudget,
          importedActual: totalActual,
        },
        managed: {
          overriddenRowCount,
          overriddenFieldCount,
          cosOverrideCount: enriched.filter((item: any) => !!item.cosOverride).length,
          latestChangeAt: governance.recentChanges[0]?.createdAt || null,
          latestChangeByName: governance.recentChanges[0]?.actorName || null,
        },
        costedExpenditure,
        variances: {
          budgetVsActual: totalBudget - totalActual,
          realisedCos,
          outOfBankTotal,
          committedUnpaidTotal,
          noRevenueLinkedCount,
          overBudgetCount: overBudgetItems.length,
        },
        approvals: governance.approvals,
        editRequests: governance.editRequests,
        microsoft: governance.microsoft,
        recentChanges: governance.recentChanges,
      },
      riskSignals,
    });
  } catch (error) {
    console.error("Expenditure breakdown error:", error);
    res.status(500).json({ error: "Failed to fetch expenditure breakdown" });
  }
});

// ==================== FINANCE REVENUE OVERRIDES ====================

router.get("/api/finance/revenue/overrides", requireAuth, async (req, res) => {
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

router.get("/api/finance/cos/overrides", requireAuth, async (req, res) => {
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

router.get("/api/finance/revenue", requireAuth, async (req, res) => {
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

router.get("/api/finance/cos", requireAuth, async (req, res) => {
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

export function registerFinanceRoutes(app: Express) {
  app.use(router);
}
