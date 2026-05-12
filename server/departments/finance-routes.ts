// Error breakdown: TS7006 implicit-any: 39, TS2345 query/param types: 33, other: 17
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin, requireCosOverrideRole } from './shared-middleware';
import { PLACEHOLDER_INVOICES, OVERRIDE_NOT_REALISED } from '../lib/finance/cos-realisation';
import {
  checkCosPeriodLock,
  lockCosPeriod,
  unlockCosPeriod,
  getCosPeriodLockStatuses,
  PERIOD_LOCK_OVERRIDE_ROLES,
  firstOfMonthSast,
} from '../lib/finance/period-lock';
import { logAuditFromReq } from '../audit-logger';
import { storage } from "../storage";
import { db } from "../db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { paramStr, parseIntParam } from "../lib/req-params";
import { effectiveAllocatedAmountExVat } from "@shared/config/qb-allocations";
import { requirePermission } from "../permission-middleware";
import { requireTrackerPermission } from "../lib/finance-route-access";
import { z } from "zod";
import { validateBody } from "../middleware/validateBody";

// ── Finance write-surface Zod schemas (Phase 2b-PR2) ──
// .passthrough() for now so existing UI payloads survive; tighten in a
// follow-up PR once traffic confirms the shape.
const isoDateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const decimalLike = z.union([z.string(), z.number()]);
const expenseDateOverrideSchema = z
  .object({
    expenseId: z.coerce.number().int().positive(),
    dateOverride: isoDateStr.nullable().optional(),
    reason: z.string().max(500).optional().nullable(),
  })
  .passthrough();
const inflowDateOverrideSchema = z
  .object({
    inflowId: z.coerce.number().int().positive(),
    dateOverride: isoDateStr.nullable().optional(),
    reason: z.string().max(500).optional().nullable(),
  })
  .passthrough();
const openingBalanceSchema = z
  .object({
    weekStartDate: isoDateStr,
    openingBalance: decimalLike,
    computedValue: decimalLike.nullable().optional(),
    clearForward: z.boolean().optional(),
  })
  .passthrough();
const opexBudgetSchema = z
  .object({
    monthKey: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM"),
    amount: decimalLike,
  })
  .passthrough();
const opexWeeklySchema = z
  .object({
    weekStartDate: isoDateStr,
    opexAmount: decimalLike,
  })
  .passthrough();
const cosPeriodLockSchema = z
  .object({ notes: z.string().max(500).optional().nullable() })
  .passthrough();
const planningOverridesSchema = z
  .object({
    overrides: z.array(z.object({
      projectName: z.string().min(1),
      overrideValue: decimalLike,
    }).passthrough()).min(1),
    overrideCategory: z.string().min(1),
    overrideComment: z.string().min(3).max(1000),
  })
  .passthrough();
const revenueTrackingOverridesSchema = z
  .object({
    overrides: z.array(z.object({
      projectName: z.string().min(1),
    }).passthrough()).min(1),
    overrideCategory: z.string().min(1),
    overrideComment: z.string().min(3).max(1000),
  })
  .passthrough();
import { applyManualOverride, manualOverridesEnabled } from "../lib/manual-overrides";
import { EXPENDITURE_TRACKED_FIELDS, REVENUE_TRACKED_FIELDS } from "@shared/excel-vs-app/contract";
import {
  approvals,
  changeSets,
  msObjects,
  OVERRIDE_CATEGORIES,
  projectInfo,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { FinanceExpenseEngineRepository } from "../repositories/finance-expense-engine-repository";
import { FinanceInflowsRepository } from "../repositories/finance-inflows-repository";
import { ProjectInfoRepository } from "../repositories/project-info-repository";
import { ManualEditFlagsRepository } from "../repositories/manual-edit-flags-repository";
import { QbReconciliationOverridesRepository } from "../repositories/qb-reconciliation-overrides-repository";
import { FinancialIntegrationRepository } from "../repositories/financial-integration-repository";
import { UsersRepository } from "../repositories/users-repository";

const financeExpenseRepository = new FinanceExpenseEngineRepository();
const financeInflowsRepository = new FinanceInflowsRepository();
const projectInfoRepository = new ProjectInfoRepository();
const manualEditFlagsRepository = new ManualEditFlagsRepository();
const qbReconRepository = new QbReconciliationOverridesRepository();
const financialIntegrationRepository = new FinancialIntegrationRepository();
const usersRepository = new UsersRepository();
const qbLinksRepository = new QuickBooksLinksRepository();
import { recordManualEdit } from "../lib/audit/diff-engine";
import { classifyExpenseState } from "../lib/calculations/stateClassifier";
import {
  STATIC_COS_BUDGET_FY26,
  extractMonthKey,
  isCosRealised as isCosRealisedShared,
  classifyCosStatusFull,
  normalizeProjectName,
  mapToSortedArray,
  currentMonthKey as getCurrentMonthKey,
  parseExpenseAmount,
} from "../lib/calculations/financeUtils";
import { recordOverride } from "../lib/audit/diff-engine";
import { isWorkItemsEnabled, getWorkItemsAsOperationalTasks } from "../work-items-adapter";
import { refreshProjectMetricsAsync } from "../services/dashboard-metrics";
import { createNotification } from "../services/notification-service";
import {
  getExpenseEffectiveDateAndSource,
  getCosEffectiveDateAndSource,
  getOutflowAmountBreakdown,
} from "../lib/expense-row-selector";
import {
  getCanonicalAllCurrentCostLines,
  getCanonicalCostLineDiagnostics,
  getCostLineRiskDiagnostics,
  getCanonicalProjectCostLines,
  getCanonicalProjectCostLinesByName,
  resolveProjectIdByName,
} from "../services/project-cost-line-read-service";
import { buildFinanceCoreTrustReport } from "../services/finance-core-trust-service";
import { setFinanceTrustHeaders as setFinanceTrustHeadersShared } from "../lib/finance-trust/envelope";
import type { FinanceTrustHeaderParams } from "../lib/finance-trust/envelope";
import { getBills, getInvoices, getMonthlyPnLReport, getQuickBooksConnectionStatus, extractMonthlyAccountTotalsFromPnL } from "../services/quickbooks-service";
import {
  billRawToSummary,
  billRawToLineRows,
  buildQbProjectResolver,
  buildRevenueProjectResolver,
  invoiceRawToSummary,
  invoiceRawToLineRows,
  normalizeProjectKey,
  parsePnLCosMonthly,
  rankRevenueProjectSuggestions,
  type QbProjectResolution,
} from "../services/quickbooks-reconciliation-service";
import {
  deriveInflowsQbStatus,
  deriveOutflowsQbStatus,
  resolveQbMatch,
} from "../lib/quickbooks-status";
import { QuickBooksLinksRepository, type QbLinkRef } from "../repositories/quickbooks-links-repository";
import { computeDateShiftDays, isQbDivergent, paymentTermsMissing } from "@shared/lib/cashflow-trust";

const FINANCIAL_APPROVER_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER"];

async function getHighRiskProjectCostReadRows(projectName: string, projectIdParam?: number | null): Promise<any[]> {
  // Operational-tab read: overlay manual_overrides on top of the live
  // column for tracked fields so the operator sees their override.
  // Gated by USE_MANUAL_OVERRIDES — when off (legacy mode), the live
  // column already holds the operator's value (writes still go to the
  // live column), so the overlay is a no-op anyway.
  const opts = { applyOverrides: manualOverridesEnabled() };
  if (projectIdParam != null && Number.isFinite(projectIdParam)) {
    return getCanonicalProjectCostLines(projectIdParam as number, opts);
  }
  return getCanonicalProjectCostLinesByName(projectName, opts).then((r) => r.rows);
}

async function getHighRiskAllCostReadRows(): Promise<any[]> {
  return getCanonicalAllCurrentCostLines({ applyOverrides: manualOverridesEnabled() });
}



function requireAdminOrFinancialEditor(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
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
  const saved = await financialIntegrationRepository.createEditRequest({
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
  });

  // Notify financial approvers about the pending edit request
  try {
    const approvers = await usersRepository.listByRoles(FINANCIAL_APPROVER_ROLES);
    for (const approver of approvers) {
      if (approver.id === userId) continue; // don't notify the requester
      await createNotification({
        recipientUserId: approver.id,
        eventType: "financial.edit_request_pending",
        title: `Financial edit request: ${projectName}`,
        body: editSummary,
        projectName,
        relatedEntityType: "financial_edit_request",
        relatedEntityId: saved.id,
      });
    }
  } catch (err) {
    console.error("[finance] Failed to send edit request notifications:", err);
  }

  return saved;
}

const router = Router();

function isDateConfirmed(confirmed: boolean | null | undefined, fontColor: string | null | undefined): boolean {
  if (fontColor === 'red') return false;
  if (fontColor === 'black') return true;
  if (confirmed === true) return true;
  return false;
}

// Delegates to shared canonical invoice-only rule in financeUtils.ts.
// Invoice number is the hard check for COS realisation.
function isCosRealised(exp: any): boolean {
  return isCosRealisedShared(exp);
}

// Unified realisation check: returns true if cost is effectively realised for a given month.
//
// CHANGED: Committed-from-prior-month no longer silently promotes to realised.
// Per business rules: "committed from prior month must NOT silently become realised
// unless it matches the invoice rule." If the line has an invoice, isCosRealised()
// will return true regardless. If it does not, it stays committed.
/**
 * Past-month auto-promote eligibility.
 *
 * Returns true iff the line:
 *   - sits in a closed month (monthKey strictly < currentMonthKey),
 *   - has a non-empty, non-placeholder invoice number,
 *   - has NOT been admin-overridden to a not-realised status (PLANNED, COMMITTED, INVOICED, APPROVED, PAID).
 *
 * Mirrors the override + placeholder gates in `isCanonicalCosRealised` so that
 * past-month lines respect explicit finance intent (overrides) and don't get
 * promoted on placeholder values like "TBC" / "N/A".
 */
function isPastMonthAutoRealised(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  if (!monthKey || monthKey >= currentMonthKey) return false;
  const override = String(exp?.cosStatusOverride ?? "").toUpperCase().trim();
  if (OVERRIDE_NOT_REALISED.has(override)) return false;
  const invoiceTrimmed = String(exp?.expenseInvoiceNumber ?? "").trim();
  if (!invoiceTrimmed) return false;
  if (PLACEHOLDER_INVOICES.has(invoiceTrimmed.toLowerCase())) return false;
  return true;
}

function isEffectivelyRealised(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  // Past-month auto-promote: once a month has closed, an invoice-bearing line
  // (with no admin "not realised" override and no placeholder invoice value)
  // is treated as realised regardless of the Excel font-color confirmation
  // flag. Font-color is a current-month vetting heuristic that stops being
  // meaningful for periods finance is no longer actively reviewing — without
  // this rule historical rows sit in "Committed" limbo forever.
  if (isPastMonthAutoRealised(exp, monthKey, currentMonthKey)) return true;
  if (!isCosRealisedShared(exp)) return false;
  // Realised lines are effective for current and past months only
  return monthKey ? monthKey <= currentMonthKey : true;
}

// Returns true if a cost is still actively committed (has PO or invoice-in-progress but not yet realised).
function isEffectivelyCommitted(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  // Past-month mirror: lines that auto-promoted to Realised must NOT also
  // count as Committed. PO-only lines (no invoice) and override-suppressed
  // lines in past months remain Committed — the supplier hasn't billed us
  // yet, or finance has explicitly held the line.
  if (isPastMonthAutoRealised(exp, monthKey, currentMonthKey)) return false;
  if (isCosRealisedShared(exp)) return false;
  const cosStatus = classifyCosStatusFull(exp);
  return cosStatus === 'Committed';
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

/**
 * Thin wrapper over the shared finance-trust envelope so existing call
 * sites in this large route file keep working without touching each one.
 * The shared helper adds refreshedAt + staleAfter + exception metadata.
 * See server/lib/finance-trust/envelope.ts for the canonical definition.
 */
function setFinanceTrustHeaders(
  res: Response,
  params: FinanceTrustHeaderParams,
) {
  setFinanceTrustHeadersShared(res, params);
}

// § 3.3 fix: this function was bucketing realised COS as revenue at the
// invoice-paid date — both wrong inputs and wrong dates. § 3.3.3:
// "Revenue is not recognised on … invoice payment". The amount must be
// the per-line revenue recognition value (already persisted at import
// time on `normalized_cost_lines.revenue_recognition_amount` per § 3.3.1
// category-scoped POC formula). The date stays at `expenseInvoicedDate`
// because the cashflow series uses invoice date to time revenue
// recognition relative to cash receipt, and that timing convention
// pre-dates this fix.
function calculateRevenueRecognition(
  expenses: any[],
  projectName: string | null
): { weekly: Map<string, Map<string, number>>, cumulative: Map<string, Map<string, number>> } {
  const weekly = new Map<string, Map<string, number>>();
  const cumulative = new Map<string, Map<string, number>>();

  const relevantExpenses = expenses.filter(e => {
    if (projectName && e.projectName !== projectName) return false;
    if (!e.expenseInvoiceNumber || !e.expenseInvoicedDate) return false;
    if (e.noRevenueLinked) return false;
    const revAmt = parseFloat((e as any).revenueRecognitionAmount as string);
    return Number.isFinite(revAmt) && revAmt !== 0;
  });

  for (const expense of relevantExpenses) {
    const pName = expense.projectName;
    const weekStart = getWeekStartDate(expense.expenseInvoicedDate);
    const amount = parseFloat((expense as any).revenueRecognitionAmount as string) || 0;

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

function resolveInflowEffectiveDates(
  inflows: any[],
  taskLinks: any[],
  operationalTasks: any[],
  planTasks: any[]
): any[] {
  const normalizeProjectName = (value: unknown): string => String(value || "").trim().toLowerCase();

  if (taskLinks.length === 0) {
    return inflows.map(inf => ({
      ...inf,
      effectiveDate: inf.adminDateOverride || inf.paymentReceivedDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate || null,
    }));
  }

  const linkMap = new Map<string, any>();
  const normalizedLinkMap = new Map<string, any>();
  const linksByRowNumber = new Map<number, any[]>();
  for (const link of taskLinks) {
    linkMap.set(`${link.projectName}::${link.milestoneRowNumber}`, link);
    normalizedLinkMap.set(`${normalizeProjectName(link.projectName)}::${link.milestoneRowNumber}`, link);
    const rowNumber = Number(link.milestoneRowNumber);
    if (Number.isFinite(rowNumber)) {
      const existing = linksByRowNumber.get(rowNumber) || [];
      existing.push(link);
      linksByRowNumber.set(rowNumber, existing);
    }
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
    const normalizedKey = `${normalizeProjectName(inf.projectName)}::${inf.rowNumber}`;
    const link =
      linkMap.get(key) ||
      normalizedLinkMap.get(normalizedKey) ||
      (() => {
        const sameRowLinks = linksByRowNumber.get(Number(inf.rowNumber)) || [];
        return sameRowLinks.length === 1 ? sameRowLinks[0] : null;
      })();

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
    financialIntegrationRepository.listEditRequestsForProjectWithRequester(projectName, 25),
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

  const changeSetIds = changeRows.map((row: any) => row.id).filter((id: any): id is number => typeof id === "number");
  const changeFieldRows = await qbReconRepository.listFieldChangesByChangeSetIds(changeSetIds);

  const userIds = Array.from(
    new Set(
      [
        ...extraUserIds,
        ...changeRows.map((row: any) => row.actorUserId),
        ...editRequestRows.map((row: any) => row.requestedByUserId),
      ].filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    )
  );

  const userRows = await usersRepository.listIdNameByIds(userIds);

  const userNameById = new Map<number, string>(
    userRows.map((row: any) => [row.id, row.name || `User ${row.id}`])
  );

  const { byChangeSet, latestByEntity } = buildFieldChangesByChangeSet(changeRows, changeFieldRows);
  const pendingApprovals = approvalRows.filter((row: any) => row.status === "pending");
  const cashAffectingApprovals = pendingApprovals.filter((row: any) => isFinanceApprovalRecord(row));
  const pendingEditRequests = editRequestRows.filter((row: any) => row.status === "pending");

  return {
    latestChangeByEntity: latestByEntity,
    userNameById,
    recentChanges: toRecentChangeSummary(changeRows, byChangeSet, userNameById),
    approvals: {
      pendingCount: pendingApprovals.length,
      affectingCashCount: cashAffectingApprovals.length,
      pending: cashAffectingApprovals.slice(0, 5).map((row: any) => ({
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
      pending: pendingEditRequests.slice(0, 5).map((row: any) => ({
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
      actionRequiredCount: microsoftRows.filter((row: any) => row.actionRequired).length,
      unreadCount: microsoftRows.filter((row: any) => row.isRead === false).length,
      linkedTaskCount: microsoftRows.filter((row: any) => row.linkedTaskId != null).length,
      recent: microsoftRows.slice(0, 5).map((row: any) => ({
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
      storage.getAllCostLinesForCashflow(),
      storage.getLatestRefresh(),
      Promise.resolve(new Map()),
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

router.get("/api/cashflow-2026", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
  try {
    const projectFilterRaw = req.query.project ? String(req.query.project) : null;
    const includeDebug = String(req.query.debug || "").toLowerCase() === "1" || String(req.query.debug || "").toLowerCase() === "true";
    const projectFilters: Set<string> | null = projectFilterRaw
      ? new Set(projectFilterRaw.split(",").map(s => s.trim()).filter(Boolean))
      : null;
    const isFiltered = projectFilters !== null && projectFilters.size > 0;

    const [allExpenses, rawInflows, manualBalances, opexBudgets, opexWeeklyOverrides, allTaskLinks, allOpTasks, allPlanTasks, qbConnectionStatus] = await Promise.all([
      storage.getAllCostLinesForCashflow(),
      storage.getAllRevenueLinesForCashflow(),
      storage.getAllCashflowWeeklyManual(),
      storage.getAllOpexBudgetMonthly(),
      storage.getAllOpexWeeklyManual(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
      getQuickBooksConnectionStatus().catch(() => null),
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

    const itemExpenses = allExpenses.filter((e: any) => e.rowType === "item");
    // Suspicious NULLs: lines with an invoice but no amount → silent 0 in total.
    let cashflowNullCount = 0;
    for (const e of itemExpenses) {
      const rawAmt = (e as any).expenseActualTotal;
      const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
      const hasInvoice = !!((e as any).expenseInvoiceNumber && String((e as any).expenseInvoiceNumber).trim());
      if (!hasAmt && hasInvoice) cashflowNullCount += 1;
    }
    for (const inf of allInflows) {
      const rawAmt = (inf as any).milestoneAmount;
      const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
      const hasInvoice = !!((inf as any).invoiceNumber && String((inf as any).invoiceNumber).trim());
      if (!hasAmt && hasInvoice) cashflowNullCount += 1;
    }
    const weeks: any[] = [];
    const diagnostics = {
      selectedExpenseRows: itemExpenses.length,
      normalizedRows: itemExpenses.filter((e: any) => !!e._isNormalized).length,
      legacyRows: itemExpenses.filter((e: any) => !e._isNormalized).length,
      positiveRows: 0,
      negativeRows: 0,
      dateSource: {
        adminDateOverride: 0,
        expensePaymentDate: 0,
        computedForecastPaymentDate: 0,
        forecastPaymentDate: 0,
        expenseInvoicedDate: 0,
        none: 0,
      },
      amountSource: {
        expenseActualTotal: 0,
        budgetTotal: 0,
      },
      actualOutflowsYtd: 0,
      forecastOutflowsYtd: 0,
      negativeOffsetsApplied: 0,
    };
    const cursor = new Date(fyStart);
    let runningBalance = 0;

    for (const expense of itemExpenses) {
      if (projectFilters && !projectFilters.has(expense.projectName || "")) continue;
      const dateInfo = getExpenseEffectiveDateAndSource(expense);
      if (dateInfo.source && (diagnostics.dateSource as any)[dateInfo.source] != null) (diagnostics.dateSource as any)[dateInfo.source] += 1;
      else diagnostics.dateSource.none += 1;
      const amountBreakdown = getOutflowAmountBreakdown(expense);
      diagnostics.amountSource[amountBreakdown.amountSource] += 1;
      if (amountBreakdown.amount > 0) diagnostics.positiveRows += 1;
      else if (amountBreakdown.amount < 0) diagnostics.negativeRows += 1;
    }

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
      let actualOutflowsSum = 0;
      let forecastOutflowsSum = 0;
      let pastDueUnpaidSum = 0;
      const todayStr = new Date().toISOString().split('T')[0];
      for (const expense of itemExpenses) {
        // Bottom-up: only aggregate leaf-node (item) rows, matching project-detail level logic
        if (projectFilters && !projectFilters.has(expense.projectName || "")) continue;

        // Use effective payment date: admin override first, then actual payment date, then computed forecast, then forecast, then invoice date
        const dateInfo = getExpenseEffectiveDateAndSource(expense);
        const d = dateInfo.date;
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;

        const amountBreakdown = getOutflowAmountBreakdown(expense);
        const amt = amountBreakdown.amount;

        if (d >= weekStart && d < weekEnd) {
          projectOutflowsSum += amt;
          if (amountBreakdown.type === "actual") actualOutflowsSum += amt;
          else forecastOutflowsSum += amt;
          if (amt < 0) diagnostics.negativeOffsetsApplied += Math.abs(amt);
          // Flag past-due unpaid: payment date in past, but not confirmed out of bank
          const payDateConfirmed = expense.expensePaymentDate && isDateConfirmed((expense as any).paymentDateConfirmed, (expense as any).paymentDateFontColor);
          if (amt > 0 && d < todayStr && !payDateConfirmed) {
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
        actualOutflows: actualOutflowsSum,
        forecastOutflows: forecastOutflowsSum,
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

    // Diagnostic: count expense sources to help debug doubled outflows
    const normalizedCount = allExpenses.filter((e: any) => e._isNormalized).length;
    const legacyCount = allExpenses.filter((e: any) => !e._isNormalized).length;
    const itemCount = allExpenses.filter((e: any) => e.rowType === 'item').length;
    const totalOutflowsYtd = weeks.reduce((s: number, w: any) => s + (w.projectOutflows || 0), 0);
    const actualOutflowsYtd = weeks.reduce((s: number, w: any) => s + (w.actualOutflows || 0), 0);
    const forecastOutflowsYtd = weeks.reduce((s: number, w: any) => s + (w.forecastOutflows || 0), 0);
    diagnostics.actualOutflowsYtd = actualOutflowsYtd;
    diagnostics.forecastOutflowsYtd = forecastOutflowsYtd;
    console.log(`[Cashflow2026] Expenses: ${allExpenses.length} total (${normalizedCount} normalized, ${legacyCount} legacy), ${itemCount} items. Outflows YTD: ${totalOutflowsYtd.toFixed(0)} (actual ${actualOutflowsYtd.toFixed(0)}, forecast ${forecastOutflowsYtd.toFixed(0)})`);

    const summaryLastImportDate = itemExpenses.reduce<string | null>((max, e: any) => {
      const at = (e.snapshotRunCommittedAt || e.createdAt)
        ? new Date(e.snapshotRunCommittedAt ?? e.createdAt).toISOString()
        : null;
      if (!at) return max;
      return max === null || at > max ? at : max;
    }, null);
    const summaryMissingTermsCount = itemExpenses.filter(
      (e: any) => paymentTermsMissing(e)
    ).length;
    const summaryShiftedLineCount = itemExpenses.filter((e: any) => {
      const days = computeDateShiftDays(
        (e.importSnapshot as Record<string, unknown> | null)?.forecastPaymentDate,
        e.forecastPaymentDate,
      );
      return days !== null && Math.abs(days) > 14;
    }).length;
    const quickBooksLinkStatus: "linked" | "partial" | "unmatched" | "unknown" =
      !qbConnectionStatus ? "unknown"
      : qbConnectionStatus.health === "healthy" && !qbConnectionStatus.isStale ? "linked"
      : qbConnectionStatus.health === "failing" ? "unmatched"
      : qbConnectionStatus.health === "stale" || qbConnectionStatus.isStale ? "partial"
      : "unknown";

    const summary = {
      lastImportDate: summaryLastImportDate,
      missingTermsCount: summaryMissingTermsCount,
      shiftedLineCount: summaryShiftedLineCount,
      quickBooksLinkStatus,
    };

    const overrideInEffect = weeks.some(
      (w: any) => w.hasManualOverride === true || w.hasOpexOverride === true || w.hasAvailPayOverride === true,
    );
    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "cashflow_points,normalized_cost_lines,normalized_revenue_lines",
      derivedTable: "cashflow_weekly_manual,opex_budget_monthly,opex_weekly_manual",
      staleAfterSeconds: 60,
      overrideInEffect,
      nullCount: cashflowNullCount,
    });

    if (includeDebug) {
      return res.json({
        weeks,
        summary,
        nullCount: cashflowNullCount,
        debug: {
          ...diagnostics,
          selectedExpenseRows: diagnostics.selectedExpenseRows,
          duplicateRowsRemoved: null,
          legacyRowsIncluded: legacyCount,
          legacyRowsExcluded: null,
        },
      });
    }

    res.json({ weeks, summary });
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
      storage.getAllCostLinesForCashflow(),
      storage.getAllRevenueLinesForCashflow(),
      storage.getAllMilestoneTaskLinks(),
      storage.getAllOperationalTasks(),
      storage.getAllProjectPlans(),
    ]);

    const resolvedInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

    const outflows = allExpenses
      .filter(e => {
        if (e.rowType !== 'item') return false;
        if (projectFilters && !projectFilters.has(e.projectName || "")) return false;
        const pd = getExpenseEffectiveDateAndSource(e).date;
        if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return false;
        return pd >= weekStart && pd < weekEnd;
      })
      .map(e => {
        const dateInfo = getExpenseEffectiveDateAndSource(e);
        const originalDate = e.expensePaymentDate || (e as any).computedForecastPaymentDate || (e as any).forecastPaymentDate || (e as any).expenseInvoicedDate || null;
        const effectiveDate = (e as any).adminDateOverride || originalDate;
        const amountBreakdown = getOutflowAmountBreakdown(e);
        const realId = e.id < 0 ? -e.id : (e.id >= 900000 ? e.id - 900000 : e.id);
        return {
          expenseId: realId,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          expenseInvoiceNumber: e.expenseInvoiceNumber,
          expensePaymentDate: effectiveDate,
          originalDate,
          hasAdminOverride: !!(e as any).adminDateOverride,
          adminDateOverride: (e as any).adminDateOverride || null,
          adminDateOverrideReason: (e as any).adminDateOverrideReason || null,
          adminDateOverrideAt: (e as any).adminDateOverrideAt || null,
          outflowType: amountBreakdown.type,
          amountSource: amountBreakdown.amountSource,
          dateSource: dateInfo.source,
          expenseActualTotal: amountBreakdown.amount,
          supplierName: e.supplierName || null,
          rowNumber: (e as any).rowNumber ?? null,
          lastImportedAt: ((e as any).snapshotRunCommittedAt || (e as any).createdAt)
            ? new Date((e as any).snapshotRunCommittedAt ?? (e as any).createdAt).toISOString()
            : null,
          paymentTermsMissing: paymentTermsMissing(e as any),
          forecastDateShiftDays: computeDateShiftDays(
            ((e as any).importSnapshot as Record<string, unknown> | null)
              ?.forecastPaymentDate,
            (e as any).forecastPaymentDate,
          ),
        };
      });

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
        const realInflowId = inf.id < 0 ? -inf.id : (inf.id >= 900000 ? inf.id - 900000 : inf.id);
        return {
          inflowId: realInflowId,
          projectName: inf.projectName,
          milestoneName: inf.milestoneName,
          milestoneInvoiceNumber: inf.milestoneInvoiceNumber,
          paymentReceivedDate: inf.effectiveDate,
          originalDate: inf.adminDateOverride ? (inf.paymentReceivedDate || inf.plannedPaymentDate || null) : null,
          hasAdminOverride: !!inf.adminDateOverride,
          adminDateOverride: inf.adminDateOverride || null,
          adminDateOverrideReason: inf.adminDateOverrideReason || null,
          adminDateOverrideAt: inf.adminDateOverrideAt || null,
          milestoneAmount: inf.milestoneAmount ? parseFloat(inf.milestoneAmount) : 0,
          invoiceRaisedDate: inf.invoiceRaisedDate,
          daysToReceipt,
          isOverride: inf.effectiveDate !== inf.paymentReceivedDate,
          customerName: inf.customerName || null,
          lastImportedAt: ((inf as any).snapshotRunCommittedAt || (inf as any).createdAt)
            ? new Date((inf as any).snapshotRunCommittedAt ?? (inf as any).createdAt).toISOString()
            : null,
        };
      });

    let qbLastSyncAt: string | null = null;
    let qbIsStale = false;
    let qbEnrichmentAvailable = false;
    let qbEnrichmentError: string | null = null;
    let billCandidates: any[] = [];
    let invoiceCandidates: any[] = [];
    let outflowLinks: QbLinkRef[] = [];
    let inflowLinks: QbLinkRef[] = [];

    try {
      // Scope QB queries to a generous window around the viewed week to avoid
      // fetching the entire ledger. Bills/invoices may have been created well
      // before the payment week, so use a 6-month lookback.
      const qbLookbackDate = new Date(Date.UTC(y, m - 1, d));
      qbLookbackDate.setUTCMonth(qbLookbackDate.getUTCMonth() - 6);
      const qbStartDate = qbLookbackDate.toISOString().split("T")[0];

      const [connectionStatus, billsRaw, invoicesRaw] = await Promise.all([
        getQuickBooksConnectionStatus(),
        getBills(qbStartDate, weekEnd),
        getInvoices(qbStartDate, weekEnd),
      ]);
      qbEnrichmentAvailable = true;
      qbLastSyncAt = connectionStatus.lastSuccessfulSyncAt;
      qbIsStale = !!connectionStatus.isStale;
      billCandidates = (billsRaw?.QueryResponse?.Bill ?? []).map(billRawToSummary).map((b: any) => ({
        id: String(b.id),
        docNumber: b.docNumber ?? null,
        totalAmount: b.totalAmount ?? null,
        balance: b.balance ?? null,
        counterpartyName: b.vendorName ?? null,
        txnDate: b.txnDate ?? null,
        statusDate: b.txnDate ?? null,
        taxUncertain: b.taxUncertain ?? false,
      }));
      invoiceCandidates = (invoicesRaw?.QueryResponse?.Invoice ?? []).map(invoiceRawToSummary).map((inv: any) => ({
        id: String(inv.id),
        docNumber: inv.docNumber ?? null,
        totalAmount: inv.totalAmount ?? null,
        balance: inv.balance ?? null,
        counterpartyName: inv.customerName ?? null,
        txnDate: inv.txnDate ?? null,
        statusDate: inv.txnDate ?? null,
        taxUncertain: inv.taxUncertain ?? false,
      }));

      const outflowIds = outflows.map((o: any) => Number(o.expenseId)).filter((id: number) => Number.isFinite(id));
      const inflowIds = inflows.map((i: any) => Number(i.inflowId)).filter((id: number) => Number.isFinite(id));

      const qbLinksRepo = new QuickBooksLinksRepository();
      const [costLinks, revenueLinks] = await Promise.all([
        qbLinksRepo.getActiveCostLineLinks(outflowIds),
        qbLinksRepo.getActiveRevenueLineLinks(inflowIds),
      ]);
      outflowLinks = costLinks;
      inflowLinks = revenueLinks;
    } catch (error: any) {
      // Keep payload working even if QB is unavailable.
      qbEnrichmentError = error?.message ? String(error.message) : "QuickBooks enrichment failed";
    }

    // Carry the full QbLinkRef so downstream divergence checks can use the
    // per-line allocatedAmountExVat instead of the QB bill's full total.
    const outflowLinkById = new Map<number, typeof outflowLinks[0]>();
    for (const link of outflowLinks) outflowLinkById.set(link.appEntityId, link);
    const inflowLinkById = new Map<number, typeof inflowLinks[0]>();
    for (const link of inflowLinks) inflowLinkById.set(link.appEntityId, link);

    const enrichedOutflows = outflows.map((row: any) => {
      const outflowLink = outflowLinkById.get(Number(row.expenseId));
      const match = resolveQbMatch({
        linkedTransactionId: outflowLink?.qbEntityId ?? row.qbTransactionId ?? null,
        invoiceNumber: row.expenseInvoiceNumber ?? null,
        projectName: row.projectName ?? null,
        counterpartyName: row.supplierName ?? null,
        amount: row.expenseActualTotal ?? null,
        candidates: billCandidates,
      });
      const qbStatus = deriveOutflowsQbStatus(match.matched?.balance ?? null, !!match.matched, row.expenseActualTotal ?? null);
      const qbUncertain = qbStatus !== "Unknown" && (qbIsStale || match.qbMatchConfidence === "low");
      const qbUncertainReason = qbIsStale
        ? "stale_sync"
        : match.qbMatchConfidence === "low"
          ? "low_confidence"
          : null;
      // Explicit link → compare against the allocated ex-VAT slice for this
      // app line. Heuristic match → compare against the full QB total (1:1).
      const qbCompareAmount = outflowLink
        ? effectiveAllocatedAmountExVat(outflowLink)
        : match.matched?.totalAmount ?? null;
      const qbDivergence = !!match.matched && isQbDivergent(
        row.expenseActualTotal !== null ? Number(row.expenseActualTotal) : null,
        qbCompareAmount,
        match.matched.taxUncertain,
      );
      return {
        ...row,
        qbStatus,
        qbStatusDate: match.matched?.statusDate ?? null,
        qbTransactionId: match.qbTransactionId,
        qbLastSyncAt,
        qbMatchConfidence: match.qbMatchConfidence,
        qbMatchType: match.qbMatchType,
        qbUncertain,
        qbUncertainReason,
        qbDivergence,
      };
    });

    const enrichedInflows = inflows.map((row: any) => {
      const inflowLink = inflowLinkById.get(Number(row.inflowId));
      const match = resolveQbMatch({
        linkedTransactionId: inflowLink?.qbEntityId ?? row.qbTransactionId ?? null,
        invoiceNumber: row.milestoneInvoiceNumber ?? null,
        projectName: row.projectName ?? null,
        counterpartyName: row.customerName ?? null,
        amount: row.milestoneAmount ?? null,
        candidates: invoiceCandidates,
      });
      const qbStatus = deriveInflowsQbStatus(match.matched?.balance ?? null, !!match.matched, row.milestoneAmount ?? null);
      const qbUncertain = qbStatus !== "Unknown" && (qbIsStale || match.qbMatchConfidence === "low");
      const qbUncertainReason = qbIsStale
        ? "stale_sync"
        : match.qbMatchConfidence === "low"
          ? "low_confidence"
          : null;
      const qbCompareAmount = inflowLink
        ? effectiveAllocatedAmountExVat(inflowLink)
        : match.matched?.totalAmount ?? null;
      const qbDivergence = !!match.matched && isQbDivergent(
        row.milestoneAmount !== null ? Number(row.milestoneAmount) : null,
        qbCompareAmount,
        match.matched.taxUncertain,
      );
      return {
        ...row,
        qbStatus,
        qbStatusDate: match.matched?.statusDate ?? null,
        qbTransactionId: match.qbTransactionId,
        qbLastSyncAt,
        qbMatchConfidence: match.qbMatchConfidence,
        qbMatchType: match.qbMatchType,
        qbUncertain,
        qbUncertainReason,
        qbDivergence,
      };
    });

    const uncertainCount = [...enrichedOutflows, ...enrichedInflows].filter((r: any) => !!r.qbUncertain).length;
    const totalRows = enrichedOutflows.length + enrichedInflows.length;
    const hasLowConfidence = [...enrichedOutflows, ...enrichedInflows].some(
      (r: any) => r.qbMatchConfidence === "low" && r.qbStatus !== "Unknown",
    );
    const missingStatusData = qbEnrichmentAvailable && totalRows > 0 && billCandidates.length === 0 && invoiceCandidates.length === 0;

    const qbMeta = {
      available: qbEnrichmentAvailable,
      degraded: !!(
        qbEnrichmentError ||
        qbIsStale ||
        missingStatusData ||
        (hasLowConfidence && uncertainCount > 0)
      ),
      reason: qbEnrichmentError
        ? "qb_unavailable"
        : qbIsStale
          ? "sync_stale"
          : missingStatusData
            ? "incomplete_data"
            : hasLowConfidence
              ? "low_confidence"
              : "ok",
      message: qbEnrichmentError
        ? "QuickBooks status unavailable. Showing app data only."
        : qbIsStale
          ? "QuickBooks sync unavailable. Statuses may be incomplete."
          : missingStatusData
            ? "QuickBooks status data is incomplete for this view."
            : hasLowConfidence
              ? "Some QuickBooks matches are low confidence."
              : null,
      lastSyncAt: qbLastSyncAt,
      uncertainCount,
      totalRows,
    };

    res.json({ outflows: enrichedOutflows, inflows: enrichedInflows, qbMeta });
  } catch (error) {
    console.error("Cashflow 2026 detail error:", error);
    res.status(500).json({ error: "Failed to fetch cashflow detail", message: "Failed to fetch cashflow detail" });
  }
});

// ==================== ADMIN DATE OVERRIDE ENDPOINTS ====================

router.post("/api/cashflow-2026/expense-date-override", requireAuth, requirePermission("cashflow", "edit"), validateBody(expenseDateOverrideSchema), async (req, res) => {
  try {
    const { expenseId, dateOverride, reason } = req.body;
    if (!expenseId) {
      return res.status(400).json({ error: "expenseId is required" });
    }
    if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      return res.status(400).json({ error: "dateOverride must be YYYY-MM-DD format or null" });
    }

    const userId = (req as any).user?.id;
    const now = new Date();

    const overrideFields = {
      adminDateOverride: dateOverride || null,
      adminDateOverrideReason: reason || null,
      adminDateOverrideBy: userId || null,
      adminDateOverrideAt: dateOverride ? now : null,
    };

    // Try normalizedCostLines first (IDs from the detail endpoint come from this table)
    const row = await financeExpenseRepository.updateCostLineAdminDateOverride(expenseId, overrideFields);
    if (!row) {
      // No matching NCL row — this expense line is not in the canonical source
      return res.status(404).json({ error: "Expense line not found in canonical cost lines" });
    }

    // Insert/update manualEditFlags for smart import conflict detection
    const flagKey = {
      entityType: "program_expense",
      entityId: Number(expenseId),
      fieldName: "adminDateOverride",
    } as const;
    if (dateOverride) {
      const existingId = await manualEditFlagsRepository.findFlagId(flagKey);
      if (existingId === null) {
        await manualEditFlagsRepository.createProtectedFlag({ ...flagKey, editedByUserId: userId, editedAt: now });
      } else {
        await manualEditFlagsRepository.refreshProtectedFlag(existingId, { editedByUserId: userId, editedAt: now });
      }
    } else {
      await manualEditFlagsRepository.deleteFlag(flagKey);
    }

    // Audit trail
    try {
      await recordManualEdit({
        actorUserId: userId,
        actorRole: (req as any).user?.role,
        entityType: "expense_admin_date_override",
        entityId: `${row.projectName}|expense${expenseId}`,
        projectName: row.projectName,
        action: dateOverride ? "EXPENSE_DATE_OVERRIDDEN" : "EXPENSE_DATE_OVERRIDE_CLEARED",
        summary: dateOverride
          ? `Admin overrode expense ${expenseId} date to ${dateOverride}${reason ? ` (${reason})` : ''}`
          : `Admin cleared expense ${expenseId} date override`,
        oldRecord: {},
        newRecord: { expenseId, dateOverride, reason },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Expense admin date override audit failed:", auditErr.message);
    }

    res.json({ success: true, updated: row });
  } catch (error) {
    console.error("Expense date override error:", error);
    res.status(500).json({ error: "Failed to save expense date override" });
  }
});

router.post("/api/cashflow-2026/inflow-date-override", requireAuth, requirePermission("cashflow", "edit"), validateBody(inflowDateOverrideSchema), async (req, res) => {
  try {
    const { inflowId, dateOverride, reason } = req.body;
    if (!inflowId) {
      return res.status(400).json({ error: "inflowId is required" });
    }
    if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      return res.status(400).json({ error: "dateOverride must be YYYY-MM-DD format or null" });
    }

    const userId = (req as any).user?.id;
    const now = new Date();

    const overrideFields = {
      adminDateOverride: dateOverride || null,
      adminDateOverrideReason: reason || null,
      adminDateOverrideBy: userId || null,
      adminDateOverrideAt: dateOverride ? now : null,
    };

    // Try normalizedRevenueLines first (IDs from the detail endpoint come from this table)
    const row = await financeInflowsRepository.updateRevenueLineAdminDateOverride(inflowId, overrideFields);
    if (!row) {
      // No matching NRL row — this inflow line is not in the canonical source
      return res.status(404).json({ error: "Inflow line not found in canonical revenue lines" });
    }

    // Insert/update manualEditFlags for smart import conflict detection
    const flagKey = {
      entityType: "program_inflows",
      entityId: Number(inflowId),
      fieldName: "adminDateOverride",
    } as const;
    if (dateOverride) {
      const existingId = await manualEditFlagsRepository.findFlagId(flagKey);
      if (existingId === null) {
        await manualEditFlagsRepository.createProtectedFlag({ ...flagKey, editedByUserId: userId, editedAt: now });
      } else {
        await manualEditFlagsRepository.refreshProtectedFlag(existingId, { editedByUserId: userId, editedAt: now });
      }
    } else {
      await manualEditFlagsRepository.deleteFlag(flagKey);
    }

    // Audit trail
    try {
      await recordManualEdit({
        actorUserId: userId,
        actorRole: (req as any).user?.role,
        entityType: "inflow_admin_date_override",
        entityId: `${row.projectName}|inflow${inflowId}`,
        projectName: row.projectName,
        action: dateOverride ? "INFLOW_DATE_OVERRIDDEN" : "INFLOW_DATE_OVERRIDE_CLEARED",
        summary: dateOverride
          ? `Admin overrode inflow ${inflowId} date to ${dateOverride}${reason ? ` (${reason})` : ''}`
          : `Admin cleared inflow ${inflowId} date override`,
        oldRecord: {},
        newRecord: { inflowId, dateOverride, reason },
      });
    } catch (auditErr: any) {
      console.warn("[audit] Inflow admin date override audit failed:", auditErr.message);
    }

    res.json({ success: true, updated: row });
  } catch (error) {
    console.error("Inflow date override error:", error);
    res.status(500).json({ error: "Failed to save inflow date override" });
  }
});

// ==================== MANUAL INPUT ENDPOINTS ====================

router.post("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), validateBody(openingBalanceSchema), async (req, res) => {
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

router.post("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "edit"), validateBody(opexBudgetSchema), async (req, res) => {
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

router.post("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), validateBody(opexWeeklySchema), async (req, res) => {
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

/**
 * LEGACY ROUTE: /api/rev-tracker
 * Canonical route: /api/revenue-tracker (below)
 * Why: /api/revenue-tracker is the route called by the frontend (revenue-tracker.tsx),
 *      uses correct permission-based auth, and has the newer calculation logic.
 * Removal plan: Remove this route after one release window once logs confirm zero usage.
 */
router.get("/api/rev-tracker", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  console.warn("[DEPRECATION] GET /api/rev-tracker called — use /api/revenue-tracker instead", {
    route: "/api/rev-tracker",
    userAgent: req.headers["user-agent"],
    referer: req.headers["referer"],
    userId: (req as any).user?.id,
  });
  return revenueTrackerHandler(req, res);
});

// ==================== COS TRACKER API ====================

router.get("/api/cos-tracker", requireAuth, async (req, res) => {
  try {
    const [manualEntries, rawCostLines, links, pnlReport] = await Promise.all([
      storage.getTrackerMonthlyManual('COS'),
      financeExpenseRepository.listAllActiveCostLines(),
      qbLinksRepository.listActiveLinksByPair("cost_line", "bill"),
      getMonthlyPnLReport("2025-09-01", "2026-08-31").catch(() => null),
    ]);

    const manualMap = new Map(manualEntries.map((e: any) => [e.monthKey, e]));
    // Task #142 — many-to-many: an app cost line may now be linked to >1 QB
    // bill (sibling allocations summing to the bill total). Multimap so we
    // don't silently drop siblings.
    const linksByCostLineId = new Map<number, any[]>();
    for (const link of links) {
      const arr = linksByCostLineId.get(link.appEntityId) ?? [];
      arr.push(link);
      linksByCostLineId.set(link.appEntityId, arr);
    }

    // QB COS totals from the P&L report (matches the QB P&L / Excel view)
    const qbCosByMonth = pnlReport ? parsePnLCosMonthly(pnlReport) : new Map<string, number>();

    const realisedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    const committedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    const plannedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    const appOnlyPendingByMonth = new Map<string, { total: number; projects: Map<string, number> }>();

    // Past-month auto-promote anchor: any month strictly before this key is
    // treated as closed for the purposes of font-color confirmation. See the
    // per-project helpers above for the matching rule.
    const nowAnchor = new Date();
    const cosCurrentMonthKey = `${nowAnchor.getUTCFullYear()}-${String(nowAnchor.getUTCMonth() + 1).padStart(2, '0')}`;

    const addProjectAmount = (
      map: Map<string, { total: number; projects: Map<string, number> }>,
      monthKey: string,
      projectName: string,
      amount: number,
    ) => {
      if (!map.has(monthKey)) map.set(monthKey, { total: 0, projects: new Map() });
      const bucket = map.get(monthKey)!;
      bucket.total += amount;
      bucket.projects.set(projectName, (bucket.projects.get(projectName) || 0) + amount);
    };

    const costLineById = new Map<number, any>();
    for (const row of rawCostLines) costLineById.set(row.id, row);

    // Suspicious NULLs: a cost line has an invoice reference but amountExVat is
    // null/blank. These silently coalesce to 0 in the total — surface as an
    // amber "(N missing)" sublabel on the client KPI.
    let cosNullCount = 0;
    for (const row of rawCostLines) {
      const rawAmt = (row as any).amountExVat;
      const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(Number(rawAmt));
      const hasInvoice = !!(row.invoiceNumber && String(row.invoiceNumber).trim());
      if (!hasAmt && hasInvoice) cosNullCount += 1;
    }

    for (const row of rawCostLines) {
      const amount = row.amountExVat ? Number(row.amountExVat) : 0;
      if (!Number.isFinite(amount) || amount === 0) continue;
      // COS realisation is bucketed by invoice_date only (per finance rule).
      // Cashflow uses payment dates separately. Rows without invoice_date are
      // not realised yet and fall out of the tracker by design.
      const lineMonthDate = row.invoiceDate;
      if (!lineMonthDate) continue;
      const dm = String(lineMonthDate).match(/^(\d{4})-(\d{2})/);
      if (!dm) continue;
      const monthKey = `${dm[1]}-${dm[2]}`;
      // Skip rows without a project association — these are OPEX/admin lines imported
      // without a project and should not inflate project-scoped COS aggregates.
      const projectName = (row.projectName || '').replace(/_Tracker$/i, '');
      if (!projectName) continue;
      const hasInvoice = !!(row.invoiceNumber && String(row.invoiceNumber).trim());
      const isPastMonth = monthKey < cosCurrentMonthKey;
      const invoiceDateConfirmed =
        !!row.invoiceDate && (
          row.invoiceDateFontColor === 'black' ||
          row.invoiceDateConfirmed === true ||
          // Past-month auto-promote: invoice number on a closed month IS
          // the confirmation.
          (isPastMonth && hasInvoice)
        );

      // COS classification — purchase order is intentionally NOT part of the
      // logic per finance rule. A PO without an invoice is still "Planned".
      //   Realised  = invoice present AND invoice date confirmed (black)
      //   Committed = invoice present AND invoice date unconfirmed (red)
      //   Planned   = no invoice
      if (hasInvoice && invoiceDateConfirmed) {
        addProjectAmount(realisedByMonth, monthKey, projectName, amount);
      } else if (hasInvoice) {
        addProjectAmount(committedByMonth, monthKey, projectName, amount);
      } else {
        addProjectAmount(plannedByMonth, monthKey, projectName, amount);
      }

      // App-only pending is explicitly "unlinked app rows with invoice captured but unconfirmed".
      if (!linksByCostLineId.has(row.id) && hasInvoice && !invoiceDateConfirmed) {
        addProjectAmount(appOnlyPendingByMonth, monthKey, projectName, amount);
      }
    }

    if (
      Array.from(realisedByMonth.values()).every((bucket) => bucket.total === 0) &&
      rawCostLines.some((row: any) => !!row.invoiceNumber)
    ) {
      console.warn("[finance-trust][cos-tracker] realised COS is zero despite invoice-bearing cost lines; check invoiceDateConfirmed and month-bucketing fields.");
    }

    const staticCosBudget = STATIC_COS_BUDGET_FY26;

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0, ytdCommitted = 0, ytdPlanned = 0, ytdQbOnly = 0, ytdAppOnlyPending = 0, ytdCosPlanned = 0, ytdCosUnrealised = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const realisedBucket = realisedByMonth.get(monthKey);
      const realisedCOS = realisedBucket?.total ?? 0;
      const committedBucket = committedByMonth.get(monthKey);
      const committedCOS = committedBucket?.total ?? 0;
      const plannedBucket = plannedByMonth.get(monthKey);
      // "plannedCOS" from unrecognised cost lines is retained for drill-down
      // detail but MUST NOT roll into totalCOS — those rows have no invoice
      // and no PO, so they are future budget, not actual cost. Including
      // them was double-counting the remaining project budget and inflating
      // the YTD figure (~R339M vs QB truth ~R220M-R230M).
      const plannedCOS = plannedBucket?.total ?? 0;
      const totalCOS = realisedCOS + committedCOS;
      // cosPlanned = full app-side baseline (every cost line in the month
      // regardless of state). Per finance rule the "COS Planned" grid row
      // shows this. Variance against budget is also computed against this
      // baseline. totalCOS (= R+C, "recognised") is retained only for the
      // QB-vs-App reconciliation metric below.
      const cosPlanned = realisedCOS + committedCOS + plannedCOS;
      // cosUnrealised = the part of the baseline that is NOT yet realised
      // = lines with no invoice (planned bucket) + lines whose invoice date
      // is still red/unconfirmed (committed bucket). Mirrors finance rule
      // "all planned without an invoice and invoice date red".
      const cosUnrealised = plannedCOS + committedCOS;
      const qbOnlyActual = qbCosByMonth.get(monthKey) ?? 0;
      const appOnlyPendingBucket = appOnlyPendingByMonth.get(monthKey);
      const appOnlyPending = appOnlyPendingBucket?.total ?? 0;

      const manual = manualMap.get(monthKey);
      const budget = manual?.budget ? parseFloat(manual.budget) : (staticCosBudget[monthKey] ?? 0);

      // QB is the source of truth for actuals. Variance compares the app's
      // recognised COS (realised + committed) against the QB booked value
      // so finance can see where reconciliation is still pending.
      const qbVsAppVariance = qbOnlyActual - totalCOS;
      const qbVsAppVariancePct = qbOnlyActual !== 0 ? (qbVsAppVariance / qbOnlyActual) * 100 : 0;

      // Variance vs budget uses the full baseline so the row sits directly
      // beneath "COS Planned" with consistent arithmetic (planned − budget).
      const variance = cosPlanned - budget;
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      ytdCOS += cosPlanned;
      ytdCosPlanned += cosPlanned;
      ytdCosUnrealised += cosUnrealised;
      ytdRealised += realisedCOS;
      ytdCommitted += committedCOS;
      ytdPlanned += plannedCOS;
      ytdQbOnly += qbOnlyActual;
      ytdAppOnlyPending += appOnlyPending;
      ytdBudget += budget;
      const ytdVariance = ytdCOS - ytdBudget;
      const ytdVariancePct = ytdBudget !== 0 ? (ytdVariance / ytdBudget) * 100 : 0;

      months.push({
        monthKey,
        monthLabel: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        totalCOS,
        cosPlanned,
        cosUnrealised,
        realisedCOS,
        committedCOS,
        plannedCOS,
        qbOnlyActual,
        appOnlyPending,
        budget,
        variance,
        variancePct,
        // QB vs App reconciliation — surface where QB and app diverge.
        qbVsAppVariance,
        qbVsAppVariancePct,
        ytdCOS,
        ytdCosPlanned,
        ytdCosUnrealised,
        ytdRealised,
        ytdCommitted,
        ytdPlanned,
        ytdQbOnly,
        ytdAppOnlyPending,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        cosProjects: [],
        realisedProjects: mapToSortedArray(realisedBucket?.projects ?? new Map()),
        committedProjects: mapToSortedArray(committedBucket?.projects ?? new Map()),
        plannedProjects: mapToSortedArray(plannedBucket?.projects ?? new Map()),
        // Per-project breakdown for the "COS Planned" row = combined R+C+P.
        cosPlannedProjects: (() => {
          const merged = new Map<string, number>();
          for (const bucket of [realisedBucket, committedBucket, plannedBucket]) {
            for (const [name, val] of bucket?.projects ?? new Map()) {
              merged.set(name, (merged.get(name) ?? 0) + val);
            }
          }
          return mapToSortedArray(merged);
        })(),
        // Per-project breakdown for the "COS Unrealised" row = Planned + Committed.
        cosUnrealisedProjects: (() => {
          const merged = new Map<string, number>();
          for (const bucket of [plannedBucket, committedBucket]) {
            for (const [name, val] of bucket?.projects ?? new Map()) {
              merged.set(name, (merged.get(name) ?? 0) + val);
            }
          }
          return mapToSortedArray(merged);
        })(),
        qbOnlyProjects: [],
        appOnlyPendingProjects: mapToSortedArray(appOnlyPendingBucket?.projects ?? new Map()),
      });
    }

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines",
      derivedTable: "quickbooks_invoice_links",
      staleAfterSeconds: 60,
      nullCount: cosNullCount,
    });
    res.json(months);
  } catch (error) {
    console.error("COS tracker error:", error);
    res.status(500).json({ error: "Failed to fetch COS tracker data", message: "Failed to fetch COS tracker data" });
  }
});

router.get("/api/cos-tracker/project/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = decodeURIComponent(String(req.params.projectName || ""));
    const projectIdParam = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
    const projectExpenses = await getHighRiskProjectCostReadRows(projectName, projectIdParam);

    const cosByMonth = new Map<string, number>();
    const realisedByMonth = new Map<string, number>();
    const committedByMonth = new Map<string, number>();
    const itemsByMonth = new Map<string, any[]>();

    const nowDate = new Date();
    // UTC anchor — must match `cosCurrentMonthKey` in /api/cos-tracker so the
    // same line classifies the same way in aggregate and per-project views.
    const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;

    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const { date: dateSource } = getCosEffectiveDateAndSource(exp);
      if (!dateSource) continue;
      const dateMatch = String(dateSource).match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      cosByMonth.set(monthKey, (cosByMonth.get(monthKey) || 0) + amount);

      const isRealised = isEffectivelyRealised(exp, monthKey, currentMonthKey);
      const isCommitted = isEffectivelyCommitted(exp, monthKey, currentMonthKey);
      if (isRealised) {
        realisedByMonth.set(monthKey, (realisedByMonth.get(monthKey) || 0) + amount);
      }
      if (isCommitted) {
        committedByMonth.set(monthKey, (committedByMonth.get(monthKey) || 0) + amount);
      }

      if (!itemsByMonth.has(monthKey)) itemsByMonth.set(monthKey, []);
      itemsByMonth.get(monthKey)!.push({
        id: exp.id,
        canonicalLineKey: (exp as any).canonicalLineKey || null,
        category: exp.expenseCategory || null,
        lineItem: exp.expenseLineItem || null,
        amount,
        invoiceNumber: exp.expenseInvoiceNumber || null,
        poNumber: exp.expensePoNumber || null,
        invoiceDate: exp.expenseInvoicedDate || null,
        supplier: exp.supplierName || null,
        isRealised,
        cosStatus: isRealised ? 'Realised' : (isCommitted ? 'Committed' : 'Planned'),
        paymentDate: exp.expensePaymentDate || null,
      });
    }

    const budgetByMonth = new Map<string, number>();
    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const budgetAmt = exp.budgetTotal ? parseFloat(exp.budgetTotal as string) : 0;
      if (isNaN(budgetAmt) || budgetAmt === 0) continue;
      const { date: budgetDate } = getCosEffectiveDateAndSource(exp);
      if (!budgetDate) continue;
      const dateMatch = String(budgetDate).match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      budgetByMonth.set(monthKey, (budgetByMonth.get(monthKey) || 0) + budgetAmt);
    }

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0, ytdCommitted = 0;

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(startMonth);
      monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
      const yr = monthDate.getUTCFullYear();
      const mo = monthDate.getUTCMonth();
      const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

      const totalCOS = cosByMonth.get(monthKey) ?? 0;
      const realisedCOS = realisedByMonth.get(monthKey) ?? 0;
      const committedCOS = committedByMonth.get(monthKey) ?? 0;
      const unrealisedCOS = totalCOS - realisedCOS;
      const budget = budgetByMonth.get(monthKey) ?? 0;
      const variance = totalCOS - budget;
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      ytdCOS += totalCOS;
      ytdRealised += realisedCOS;
      ytdCommitted += committedCOS;
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
        committedCOS,
        unrealisedCOS,
        budget,
        variance,
        variancePct,
        ytdCOS,
        ytdRealised,
        ytdCommitted,
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
    const { monthKey, fromMonthKey, project, state: stateFilter } = req.query as { monthKey?: string; fromMonthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const match = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) return res.status(400).json({ error: "Invalid monthKey format" });

    // YTD drilldown: when fromMonthKey is set, the response covers every month
    // from fromMonthKey through monthKey inclusive. Used by the YTD rows on
    // the COS grid (ytdRealised, ytdCommitted, ytdQbOnly) so their drawers
    // sum to the cumulative figure shown in the cell.
    let fromMatch: RegExpMatchArray | null = null;
    if (fromMonthKey) {
      fromMatch = fromMonthKey.match(/^(\d{4})-(\d{2})$/);
      if (!fromMatch) return res.status(400).json({ error: "Invalid fromMonthKey format" });
      if (fromMonthKey > monthKey) return res.status(400).json({ error: "fromMonthKey must be <= monthKey" });
    }
    const startKey = fromMonthKey || monthKey;
    const startMatch = fromMatch || match;
    const monthStart = `${startKey}-01`;
    const lastDay = new Date(Number(match[1]), Number(match[2]), 0).getDate();
    const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
    void startMatch;

    // The drilldown MUST classify lines using the same app-side rules the
    // aggregate /api/cos-tracker uses, otherwise drawer rows won't sum to the
    // clicked cell value. Bucketing rules (mirror of aggregate):
    //   realised  = hasInvoice && invoiceDateConfirmed (with past-month auto-promote)
    //   committed = !realised && (hasInvoice || hasPo)
    //   planned   = !realised && !committed (no invoice, no PO)
    // QB linkage is a separate concern surfaced via matchStatus only — it does
    // NOT change which bucket the line falls into.
    const nowAnchor = new Date();
    const cosCurrentMonthKey = `${nowAnchor.getUTCFullYear()}-${String(nowAnchor.getUTCMonth() + 1).padStart(2, '0')}`;

    const [allCostLines, links, rawBills] = await Promise.all([
      financeExpenseRepository.listAllActiveCostLines(),
      qbLinksRepository.listActiveLinksByPair("cost_line", "bill"),
      getBills(monthStart, monthEnd).catch((err) => {
        console.warn("[cos-month-detail] getBills failed — continuing with app-only data:", err instanceof Error ? err.message : err);
        return { QueryResponse: { Bill: [] } };
      }),
    ]);

    interface LineItem {
      id: string;
      projectName: string | null;
      category: string | null;
      lineItem: string | null;
      appAmount: number | null;
      qbAmount: number | null;
      // contributionAmount is the value this row contributes to the bucket
      // shown in the grid cell. For app states (realised/committed/planned) it
      // equals appAmount; for qb_actual it equals qbAmount. The drawer sums
      // contributionAmount so the displayed total always equals the cell.
      contributionAmount: number;
      invoiceNumber: string | null;
      qbBillNumber: string | null;
      invoiceDate: string | null;
      invoiceDateConfirmed: boolean;
      supplier: string | null;
      month: string;
      poNumber: string | null;
      qbTransactionType: string | null;
      qbTransactionDate: string | null;
      recognitionDate: string | null;
      syncSource: string | null;
      sourceTraceId: string | null;
      matchStatus: "matched" | "qb_only" | "app_only";
      cosState: "realised" | "committed" | "planned" | "qb_actual";
      reasonBucket: "matched realised" | "matched committed" | "QB-only actual" | "app-only pending" | "planned";
      // Smart Import v2 tracker check flag from normalized_cost_lines.
      // Surfaced so the COS drawer can show whether a line was flagged
      // for review on the source workbook.
      checkFlag: string | null;
    }

    const items: LineItem[] = [];
    // Task #142 multimap (see /api/cos-tracker note above).
    const linksByCostLineId = new Map<number, any[]>();
    const linkedBillIds = new Set<string>();
    for (const link of links) {
      const arr = linksByCostLineId.get(link.appEntityId) ?? [];
      arr.push(link);
      linksByCostLineId.set(link.appEntityId, arr);
      linkedBillIds.add(String(link.qbEntityId));
    }

    const bills: any[] = (rawBills?.QueryResponse?.Bill ?? []).map(billRawToSummary);
    const billById = new Map<string, any>();
    for (const bill of bills) billById.set(String(bill.id), bill);

    // The "COS Planned" row in the grid shows the full app-side baseline =
    // realised + committed + planned. Clicking it drills down with
    // state=recognised, which on this route now means "all app states"
    // (every cost line regardless of stage). This is intentionally a
    // superset of realised+committed; QB-only bills are still excluded.
    // "unrealised" filter = planned + committed (everything not yet realised).
    const stateFilterNorm = stateFilter === "recognised" ? "recognised" : stateFilter;

    for (const row of allCostLines) {
      const appAmount = row.amountExVat ? Number(row.amountExVat) : 0;
      if (!Number.isFinite(appAmount) || appAmount === 0) continue;
      const projectName = (row.projectName || '').replace(/_Tracker$/i, '') || null;
      if (!projectName) continue;

      // Month bucket — invoice_date only, identical to the aggregate.
      const appMonth = String(row.invoiceDate || '').slice(0, 7) || null;
      if (!appMonth) continue;
      if (fromMonthKey) {
        if (appMonth < fromMonthKey || appMonth > monthKey) continue;
      } else {
        if (appMonth !== monthKey) continue;
      }
      if (project && projectName !== project) continue;

      const hasInvoice = !!(row.invoiceNumber && String(row.invoiceNumber).trim());
      // YTD-aware: each line's "past month" check uses its own appMonth, not
      // the URL's monthKey — otherwise a Sep line in a YTD-through-Jan range
      // would lose its past-month auto-promote.
      const isPastMonth = appMonth < cosCurrentMonthKey;
      const invoiceDateConfirmed =
        !!row.invoiceDate && (
          (row as any).invoiceDateFontColor === 'black' ||
          (row as any).invoiceDateConfirmed === true ||
          (isPastMonth && hasInvoice)
        );

      // App-side classification (matches aggregate exactly). Purchase order
      // is intentionally NOT part of the logic — a PO without an invoice
      // is still "Planned".
      let cosState: "realised" | "committed" | "planned";
      if (hasInvoice && invoiceDateConfirmed) cosState = "realised";
      else if (hasInvoice) cosState = "committed";
      else cosState = "planned";

      const linksForRow = linksByCostLineId.get(row.id) ?? [];
      // Pick the first sibling as the representative for legacy display
      // fields (qbEntityId, billById lookup). Sum of allocated amounts is
      // computed below for the qbAmount column so partial allocations are
      // preserved.
      const link = linksForRow[0];
      const linkedBill = link ? billById.get(String(link.qbEntityId)) : null;
      const matchStatus: "matched" | "app_only" = linksForRow.length > 0 ? "matched" : "app_only";

      const reasonBucket: LineItem["reasonBucket"] =
        cosState === "realised" ? "matched realised"
        : cosState === "committed" ? "matched committed"
        : (hasInvoice && !invoiceDateConfirmed) ? "app-only pending"
        : "planned";

      // App-side filters: only keep rows whose cosState matches.
      if (stateFilterNorm === "realised" && cosState !== "realised") continue;
      if (stateFilterNorm === "committed" && cosState !== "committed") continue;
      if (stateFilterNorm === "planned" && cosState !== "planned") continue;
      if (stateFilterNorm === "unrealised" && !(cosState === "planned" || cosState === "committed")) continue;
      // "recognised" filter = all app-side states (R+C+P) so it matches the
      // "COS Planned" row total. QB-only bills are always excluded for this
      // filter (handled by the includeQbOnly gate further down).
      // (No-op: every app row passes; the filter exists only to suppress QB.)
      // qb_actual filter only returns QB-only bills (handled below); skip app rows.
      if (stateFilterNorm === "qb_actual") continue;

      items.push({
        id: `app-${row.id}`,
        projectName,
        category: (row as any).category || null,
        lineItem: row.description || null,
        appAmount,
        qbAmount: linkedBill?.totalAmount ?? null,
        contributionAmount: appAmount,
        invoiceNumber: row.invoiceNumber || null,
        qbBillNumber: linkedBill?.docNumber ?? null,
        invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
        invoiceDateConfirmed,
        supplier: row.counterpartyName || linkedBill?.vendorName || null,
        month: appMonth || monthKey,
        poNumber: row.poNumber || null,
        checkFlag: (row as any).checkFlag ?? null,
        qbTransactionType: linkedBill ? "Bill" : null,
        qbTransactionDate: linkedBill?.txnDate ?? null,
        recognitionDate: row.invoiceDate ? String(row.invoiceDate) : (linkedBill?.txnDate ?? null),
        syncSource: linkedBill ? "quickbooks" : "app",
        sourceTraceId: linkedBill ? `qb-bill:${linkedBill.id}` : `ncl:${row.id}`,
        matchStatus,
        cosState,
        reasonBucket,
      });
    }

    // QB-only bills are only relevant when the user clicked the QuickBooks COS
    // cell (state=qb_actual) or opened the drawer with no filter (state=all).
    // For app-side filters they would dilute the displayed total.
    const includeQbOnly = !stateFilterNorm || stateFilterNorm === "all" || stateFilterNorm === "qb_actual";
    if (includeQbOnly) {
      for (const bill of bills) {
        if (linkedBillIds.has(String(bill.id))) continue;
        const billMonth = bill.txnDate?.slice(0, 7);
        if (!billMonth) continue;
        if (fromMonthKey) {
          if (billMonth < fromMonthKey || billMonth > monthKey) continue;
        } else {
          if (billMonth !== monthKey) continue;
        }
        const qbAmt = bill.totalAmount ?? 0;
        items.push({
          id: `qb-${bill.id}`,
          projectName: null,
          category: null,
          lineItem: null,
          appAmount: null,
          qbAmount: qbAmt,
          contributionAmount: qbAmt,
          invoiceNumber: null,
          qbBillNumber: bill.docNumber,
          invoiceDate: bill.txnDate,
          invoiceDateConfirmed: true,
          supplier: bill.vendorName || null,
          month: billMonth,
          poNumber: null,
          checkFlag: null,
          qbTransactionType: "Bill",
          qbTransactionDate: bill.txnDate,
          recognitionDate: bill.txnDate,
          syncSource: "quickbooks",
          sourceTraceId: `qb-bill:${bill.id}`,
          matchStatus: "qb_only",
          cosState: "qb_actual",
          reasonBucket: "QB-only actual",
        });
      }
    }

    items.sort((a, b) => (b.contributionAmount ?? 0) - (a.contributionAmount ?? 0));

    const realisedTotal = items.filter(i => i.cosState === "realised").reduce((s, i) => s + (i.appAmount ?? 0), 0);
    const committedTotal = items.filter(i => i.cosState === "committed").reduce((s, i) => s + (i.appAmount ?? 0), 0);
    const plannedTotal = items.filter(i => i.cosState === "planned").reduce((s, i) => s + (i.appAmount ?? 0), 0);
    const qbOnlyTotal = items.filter(i => i.cosState === "qb_actual").reduce((s, i) => s + (i.qbAmount ?? 0), 0);
    // recognisedTotal = full app-side baseline (R+C+P) to match the
    // "COS Planned" grid row that drills down with state=recognised.
    const recognisedTotal = realisedTotal + committedTotal + plannedTotal;
    // unrealisedTotal = planned + committed = everything not yet realised.
    const unrealisedTotal = plannedTotal + committedTotal;
    // expectedTotal = sum of contributions for the active filter — this is what
    // the cell shows, so the drawer header can verify the math out of the box.
    const expectedTotal =
      stateFilterNorm === "realised" ? realisedTotal
      : stateFilterNorm === "committed" ? committedTotal
      : stateFilterNorm === "planned" ? plannedTotal
      : stateFilterNorm === "unrealised" ? unrealisedTotal
      : stateFilterNorm === "qb_actual" ? qbOnlyTotal
      : stateFilterNorm === "recognised" ? recognisedTotal
      : (realisedTotal + committedTotal + plannedTotal + qbOnlyTotal);

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines,quickbooks_invoice_links",
    });
    res.json({
      monthKey,
      lineCount: items.length,
      totalAmount: realisedTotal + committedTotal + qbOnlyTotal,
      realisedTotal,
      committedTotal,
      plannedTotal,
      recognisedTotal,
      unrealisedTotal,
      qbOnlyTotal,
      expectedTotal,
      appOnlyPendingTotal: plannedTotal,
      realisedCount: items.filter(i => i.cosState === "realised").length,
      committedCount: items.filter(i => i.cosState === "committed").length,
      plannedCount: items.filter(i => i.cosState === "planned").length,
      items,
    });
  } catch (error) {
    console.error("COS month detail error:", error);
    res.status(500).json({ error: "Failed to fetch COS month detail" });
  }
});

/**
 * QuickBooks → Project resolver coverage report (Phase 1, admin-only).
 *
 * Pulls QB Bills for a date range, runs the line-row extractor + project
 * resolver, and returns a JSON report so finance can validate which QB
 * bills are unmapped (Class typo / missing Class) and which are resolved
 * to projects but missing from the Excel trackers (the source of truth).
 *
 * READ-ONLY. Never writes to normalized_cost_lines or quickbooks_invoice_links.
 * Trackers stay the source of truth — this just shows what's missing.
 *
 *   GET /api/cos-tracker/qb-coverage-report?start=2025-09-01&end=2025-10-31
 */
router.get("/api/cos-tracker/qb-coverage-report", requireAuth, requireAdmin, async (req, res) => {
  try {
    const start = String(req.query.start || "");
    const end = String(req.query.end || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: "start and end required as YYYY-MM-DD" });
    }

    // Project-name universe = project_info ∪ active normalized_cost_lines.project_name
    const [projects, ncl] = await Promise.all([
      projectInfoRepository.listAllProjectNames(),
      financeExpenseRepository.listActiveCostLineProjectNames(),
    ]);
    const universe = new Set<string>();
    for (const p of projects) if (p.name) universe.add(p.name);
    for (const r of ncl) if (r.name) universe.add(r.name);
    const projectNames = [...universe];

    // Active cost lines bucketed by normalised project key for tracker_gap preview.
    const activeCostLines = await financeExpenseRepository.listActiveCostLinesForTrackerGap();
    const costLinesByProjectKey = new Map<string, typeof activeCostLines>();
    for (const cl of activeCostLines) {
      const key = normalizeProjectKey(cl.projectName);
      if (!key) continue;
      if (!costLinesByProjectKey.has(key)) costLinesByProjectKey.set(key, []);
      costLinesByProjectKey.get(key)!.push(cl);
    }

    const billsResp = await getBills(start, end);
    const bills: any[] = billsResp?.QueryResponse?.Bill ?? [];

    const resolveProject = buildQbProjectResolver(projectNames);
    const rows: any[] = [];
    for (const bill of bills) {
      for (const lr of billRawToLineRows(bill)) {
        const resolution = resolveProject({
          classRefName: lr.classRefName,
          customerRefName: lr.customerRefName,
        });
        let closest: any = null;
        if (resolution.projectName) {
          const candidates =
            costLinesByProjectKey.get(normalizeProjectKey(resolution.projectName)) ?? [];
          const target = lr.lineAmountExVat ?? 0;
          const close = candidates
            .map((c: any) => ({ c, diff: Math.abs(Number(c.amountExVat ?? 0) - target) }))
            .filter((x: any) => x.diff <= 1)
            .sort((a: any, b: any) => a.diff - b.diff)[0];
          if (close) {
            closest = {
              id: close.c.id,
              invoiceNumber: close.c.invoiceNumber,
              invoiceDate: close.c.invoiceDate ? String(close.c.invoiceDate) : null,
              amountExVat:
                close.c.amountExVat !== null && close.c.amountExVat !== undefined
                  ? Number(close.c.amountExVat)
                  : null,
              counterpartyName: close.c.counterpartyName,
            };
          }
        }
        rows.push({
          ...lr,
          resolvedProjectName: resolution.projectName,
          strategy: resolution.strategy,
          matchedFrom: resolution.matchedFrom,
          closestCostLineMatch: closest,
        });
      }
    }

    // Aggregations.
    const byStrategy: Record<string, { count: number; amount: number }> = {};
    let totalAmount = 0;
    let resolvedAmount = 0;
    let trackerGapAmount = 0;
    let trackerGapCount = 0;
    for (const r of rows) {
      const amt = r.lineAmountExVat ?? 0;
      totalAmount += amt;
      if (!byStrategy[r.strategy]) byStrategy[r.strategy] = { count: 0, amount: 0 };
      byStrategy[r.strategy]!.count += 1;
      byStrategy[r.strategy]!.amount += amt;
      if (r.resolvedProjectName) {
        resolvedAmount += amt;
        if (!r.closestCostLineMatch) {
          trackerGapAmount += amt;
          trackerGapCount += 1;
        }
      }
    }
    const unmappedClasses = new Map<string, { count: number; amount: number }>();
    for (const r of rows) {
      if (r.strategy === "unmapped_class" && r.classRefName) {
        if (!unmappedClasses.has(r.classRefName))
          unmappedClasses.set(r.classRefName, { count: 0, amount: 0 });
        const slot = unmappedClasses.get(r.classRefName)!;
        slot.count += 1;
        slot.amount += r.lineAmountExVat ?? 0;
      }
    }
    const unmappedClassList = [...unmappedClasses.entries()]
      .map(([classRefName, v]) => ({ classRefName, ...v }))
      .sort((a, b) => b.amount - a.amount);

    const fuzzyMatches = rows
      .filter((r) => r.strategy === "class_substring" || r.strategy === "customer_substring")
      .map((r) => ({
        billId: r.billId,
        docNumber: r.docNumber,
        txnDate: r.txnDate,
        vendorName: r.vendorName,
        lineAmountExVat: r.lineAmountExVat,
        matchedFrom: r.matchedFrom,
        resolvedProjectName: r.resolvedProjectName,
        strategy: r.strategy,
      }));

    const trackerGapPreview = rows
      .filter((r) => r.resolvedProjectName && !r.closestCostLineMatch)
      .map((r) => ({
        project: r.resolvedProjectName,
        billId: r.billId,
        docNumber: r.docNumber,
        txnDate: r.txnDate,
        vendorName: r.vendorName,
        lineAmountExVat: r.lineAmountExVat,
        classRefName: r.classRefName,
        description: r.description,
      }))
      .sort((a, b) => (b.lineAmountExVat ?? 0) - (a.lineAmountExVat ?? 0));

    res.json({
      generatedAt: new Date().toISOString(),
      window: { start, end },
      summary: {
        totalBills: bills.length,
        totalLineRows: rows.length,
        totalAmountExVat: Math.round(totalAmount * 100) / 100,
        resolvedAmountExVat: Math.round(resolvedAmount * 100) / 100,
        resolvedPct: totalAmount > 0 ? Math.round((resolvedAmount / totalAmount) * 10000) / 100 : 0,
        trackerGapCount,
        trackerGapAmountExVat: Math.round(trackerGapAmount * 100) / 100,
        projectUniverseSize: projectNames.length,
      },
      byStrategy,
      unmappedClasses: unmappedClassList,
      fuzzyMatches,
      trackerGapPreview,
    });
  } catch (err) {
    console.error("[qb-coverage-report]", err);
    res
      .status(500)
      .json({ error: "qb_coverage_report_failed", detail: "An unexpected server error occurred" });
  }
});

/**
 * Tracker Gap (C004) — admin-only annotated coverage report.
 *
 * Wraps `qb-coverage-report` and merges in user annotations:
 *   - active rows from `qb_recon_ignores` (suppress matching tracker_gap rows)
 *   - active rows from `qb_class_project_overrides` (rescue unmapped_class rows)
 *
 * READ-ONLY against `normalized_cost_lines` / `quickbooks_invoice_links`.
 * Trackers remain the source of truth — the only writes here are to the
 * annotation tables (`POST /ignore`, `POST /class-override`).
 *
 *   GET /api/cos-tracker/tracker-gap?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
router.get("/api/cos-tracker/tracker-gap", requireAuth, requirePermission("cos", "edit"), async (req, res) => {
  try {
    const start = String(req.query.start || "");
    const end = String(req.query.end || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: "start and end required as YYYY-MM-DD" });
    }

    // Project-name universe = project_info ∪ active normalized_cost_lines.project_name
    const [projects, ncl, classOverrides, ignores] = await Promise.all([
      projectInfoRepository.listAllProjectNames(),
      financeExpenseRepository.listActiveCostLineProjectNames(),
      qbReconRepository.listActiveClassOverrides(),
      qbReconRepository.listActiveReconIgnores(),
    ]);
    const universe = new Set<string>();
    for (const p of projects) if (p.name) universe.add(p.name);
    for (const r of ncl) if (r.name) universe.add(r.name);
    const projectNames = [...universe];

    // Class override lookup (case-insensitive on classRefName)
    const overrideByClass = new Map<string, string>();
    for (const o of classOverrides) {
      overrideByClass.set(o.classRefName.toLowerCase().trim(), o.projectName);
    }

    // Ignore lookup keyed on `${qbBillId}::${qbLineId ?? ""}`
    const ignoreKey = (billId: string | null, lineId: string | null) =>
      `${billId ?? ""}::${lineId ?? ""}`;

    // Active cost lines bucketed by normalised project key for tracker_gap matching.
    const activeCostLines = await financeExpenseRepository.listActiveCostLinesForTrackerGap();
    const costLinesByProjectKey = new Map<string, typeof activeCostLines>();
    for (const cl of activeCostLines) {
      const key = normalizeProjectKey(cl.projectName);
      if (!key) continue;
      if (!costLinesByProjectKey.has(key)) costLinesByProjectKey.set(key, []);
      costLinesByProjectKey.get(key)!.push(cl);
    }

    let billsResp: any;
    try {
      billsResp = await getBills(start, end);
    } catch (qbErr) {
      console.error("[tracker-gap] QB getBills failed:", qbErr);
      return res.status(503).json({
        error: "qb_not_connected",
        detail: "QuickBooks integration is unavailable. Reconnect QB to refresh the gap report.",
        message: qbErr instanceof Error ? qbErr.message : String(qbErr),
      });
    }
    const bills: any[] = billsResp?.QueryResponse?.Bill ?? [];

    const resolveProject = buildQbProjectResolver(projectNames);

    type GapBucket = "tracker_gap" | "unmapped_class" | "unmapped_no_class" | "matched" | "fuzzy";
    interface GapRow {
      bucket: GapBucket;
      billId: string | null;
      qbLineId: string | null;
      docNumber: string | null;
      txnDate: string | null;
      vendorName: string | null;
      lineAmountExVat: number | null;
      classRefName: string | null;
      customerRefName: string | null;
      accountRefName: string | null;
      description: string | null;
      resolvedProjectName: string | null;
      strategy: string;
      matchedFrom: string | null;
      isOverride: boolean;
      isIgnored: boolean;
      ignoreReason: string | null;
      ignoredByName: string | null;
      ignoredAt: string | null;
      closestCostLineId: number | null;
    }

    const ignoreMeta = new Map<string, { reason: string; ignoredByName: string | null; ignoredAt: string }>();
    for (const ig of ignores) {
      ignoreMeta.set(ignoreKey(ig.qbBillId, ig.qbLineId), {
        reason: ig.reason,
        ignoredByName: ig.ignoredByName,
        ignoredAt: ig.ignoredAt.toISOString(),
      });
    }

    const rows: GapRow[] = [];
    for (const bill of bills) {
      for (const lr of billRawToLineRows(bill)) {
        let resolution = resolveProject({
          classRefName: lr.classRefName,
          customerRefName: lr.customerRefName,
        });
        let isOverride = false;
        if (!resolution.projectName && lr.classRefName) {
          const override = overrideByClass.get(lr.classRefName.toLowerCase().trim());
          if (override) {
            resolution = {
              projectName: override,
              strategy: "class_override" as any,
              matchedFrom: lr.classRefName,
            };
            isOverride = true;
          }
        }

        // Match against tracker cost lines (project + amount within R1)
        let closestId: number | null = null;
        if (resolution.projectName) {
          const candidates = costLinesByProjectKey.get(normalizeProjectKey(resolution.projectName)) ?? [];
          const target = lr.lineAmountExVat ?? 0;
          const close = candidates
            .map((c: any) => ({ c, diff: Math.abs(Number(c.amountExVat ?? 0) - target) }))
            .filter((x: any) => x.diff <= 1)
            .sort((a: any, b: any) => a.diff - b.diff)[0];
          if (close) closestId = close.c.id;
        }

        let bucket: GapBucket;
        if (resolution.projectName && closestId) bucket = "matched";
        else if (resolution.projectName) bucket = "tracker_gap"; // fuzzy-resolved rows fold in here; UI shows the strategy badge so finance can confirm
        else if (lr.classRefName) bucket = "unmapped_class";
        else bucket = "unmapped_no_class";

        const igk = ignoreKey(lr.billId, lr.lineId);
        const ig = ignoreMeta.get(igk);

        rows.push({
          bucket,
          billId: lr.billId,
          qbLineId: lr.lineId,
          docNumber: lr.docNumber,
          txnDate: lr.txnDate,
          vendorName: lr.vendorName,
          lineAmountExVat: lr.lineAmountExVat,
          classRefName: lr.classRefName,
          customerRefName: lr.customerRefName,
          accountRefName: lr.accountRefName,
          description: lr.description,
          resolvedProjectName: resolution.projectName,
          strategy: resolution.strategy,
          matchedFrom: resolution.matchedFrom,
          isOverride,
          isIgnored: !!ig,
          ignoreReason: ig?.reason ?? null,
          ignoredByName: ig?.ignoredByName ?? null,
          ignoredAt: ig?.ignoredAt ?? null,
          closestCostLineId: closestId,
        });
      }
    }

    // Aggregations — exclude ignored from "open" totals, keep them surfaced separately.
    let totalAmount = 0;
    let openTrackerGapAmount = 0;
    let openTrackerGapCount = 0;
    let ignoredAmount = 0;
    let ignoredCount = 0;
    const byBucket: Record<GapBucket, { count: number; amount: number; openCount: number; openAmount: number }> = {
      tracker_gap: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
      unmapped_class: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
      unmapped_no_class: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
      matched: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
      fuzzy: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
    };
    for (const r of rows) {
      const amt = r.lineAmountExVat ?? 0;
      totalAmount += amt;
      byBucket[r.bucket].count += 1;
      byBucket[r.bucket].amount += amt;
      if (!r.isIgnored) {
        byBucket[r.bucket].openCount += 1;
        byBucket[r.bucket].openAmount += amt;
      } else {
        ignoredAmount += amt;
        ignoredCount += 1;
      }
      if (r.bucket === "tracker_gap" && !r.isIgnored) {
        openTrackerGapAmount += amt;
        openTrackerGapCount += 1;
      }
    }

    // Per-project rollup (for tracker_gap rows only — that's the actionable bucket)
    const byProject = new Map<string, { project: string; count: number; openCount: number; amount: number; openAmount: number }>();
    for (const r of rows) {
      if (r.bucket !== "tracker_gap") continue;
      const key = r.resolvedProjectName ?? "(unknown)";
      if (!byProject.has(key)) byProject.set(key, { project: key, count: 0, openCount: 0, amount: 0, openAmount: 0 });
      const slot = byProject.get(key)!;
      slot.count += 1;
      slot.amount += r.lineAmountExVat ?? 0;
      if (!r.isIgnored) {
        slot.openCount += 1;
        slot.openAmount += r.lineAmountExVat ?? 0;
      }
    }

    // Unmapped-class rollup with current override hint (suggest most-frequent customer name as guess)
    const unmappedClassMap = new Map<string, { classRefName: string; count: number; amount: number; sampleVendors: Set<string>; sampleCustomers: Set<string> }>();
    for (const r of rows) {
      if (r.bucket !== "unmapped_class" || !r.classRefName) continue;
      if (!unmappedClassMap.has(r.classRefName))
        unmappedClassMap.set(r.classRefName, { classRefName: r.classRefName, count: 0, amount: 0, sampleVendors: new Set(), sampleCustomers: new Set() });
      const slot = unmappedClassMap.get(r.classRefName)!;
      slot.count += 1;
      slot.amount += r.lineAmountExVat ?? 0;
      if (r.vendorName) slot.sampleVendors.add(r.vendorName);
      if (r.customerRefName) slot.sampleCustomers.add(r.customerRefName);
    }
    const unmappedClassList = [...unmappedClassMap.values()]
      .map((v) => ({
        classRefName: v.classRefName,
        count: v.count,
        amount: Math.round(v.amount * 100) / 100,
        sampleVendors: [...v.sampleVendors].slice(0, 5),
        sampleCustomers: [...v.sampleCustomers].slice(0, 5),
      }))
      .sort((a, b) => b.amount - a.amount);

    res.json({
      generatedAt: new Date().toISOString(),
      window: { start, end },
      summary: {
        totalLineRows: rows.length,
        totalAmountExVat: Math.round(totalAmount * 100) / 100,
        openTrackerGapCount,
        openTrackerGapAmountExVat: Math.round(openTrackerGapAmount * 100) / 100,
        ignoredCount,
        ignoredAmountExVat: Math.round(ignoredAmount * 100) / 100,
        projectUniverseSize: projectNames.length,
        classOverridesActive: classOverrides.length,
      },
      byBucket: Object.fromEntries(
        Object.entries(byBucket).map(([k, v]) => [
          k,
          {
            count: v.count,
            amount: Math.round(v.amount * 100) / 100,
            openCount: v.openCount,
            openAmount: Math.round(v.openAmount * 100) / 100,
          },
        ]),
      ),
      byProject: [...byProject.values()].sort((a: any, b: any) => b.openAmount - a.openAmount),
      unmappedClasses: unmappedClassList,
      classOverrides: classOverrides.map((o: any) => ({
        id: o.id,
        classRefName: o.classRefName,
        projectName: o.projectName,
        note: o.note,
        createdByName: o.createdByName,
        createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
      })),
      rows,
    });
  } catch (err) {
    console.error("[tracker-gap]", err);
    res.status(500).json({ error: "tracker_gap_failed", detail: "An unexpected server error occurred" });
  }
});

const ignoreBodySchema = z.object({
  qbBillId: z.string().min(1),
  qbLineId: z.string().nullable().optional(),
  qbDocNumber: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  lineAmountExVat: z.number().nullable().optional(),
  resolvedProjectName: z.string().nullable().optional(),
  reason: z.string().min(1).max(500),
});

router.post("/api/cos-tracker/tracker-gap/ignore", requireAuth, requirePermission("cos", "edit"), validateBody(ignoreBodySchema), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof ignoreBodySchema>;
    const user = (req as any).user;
    const created = await qbReconRepository.createReconIgnore({
      qbBillId: body.qbBillId,
      qbLineId: body.qbLineId ?? null,
      qbDocNumber: body.qbDocNumber ?? null,
      vendorName: body.vendorName ?? null,
      lineAmountExVat: body.lineAmountExVat != null ? String(body.lineAmountExVat) : null,
      resolvedProjectName: body.resolvedProjectName ?? null,
      reason: body.reason,
      ignoredByUserId: user?.id ?? null,
      ignoredByName: user?.name ?? user?.email ?? null,
    });
    // Audit: every ignore is captured with reason + actor + before/after for forensic replay.
    await logAuditFromReq(req, {
      entityType: "qb_recon_ignore",
      entityId: String(created.id),
      action: "create",
      changesJson: {
        previous_state: null,
        new_state: {
          qbBillId: body.qbBillId,
          qbLineId: body.qbLineId ?? null,
          qbDocNumber: body.qbDocNumber ?? null,
          vendorName: body.vendorName ?? null,
          lineAmountExVat: body.lineAmountExVat ?? null,
          resolvedProjectName: body.resolvedProjectName ?? null,
        },
        reason: body.reason,
      },
      projectName: body.resolvedProjectName ?? undefined,
    });
    res.json({ ok: true, ignore: created });
  } catch (err) {
    console.error("[tracker-gap/ignore]", err);
    res.status(500).json({ error: "ignore_failed", detail: "An unexpected server error occurred" });
  }
});

const ignoreUndoBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

router.delete("/api/cos-tracker/tracker-gap/ignore/:id", requireAuth, requirePermission("cos", "edit"), validateBody(ignoreUndoBodySchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
    const body = req.body as z.infer<typeof ignoreUndoBodySchema>;
    // Capture pre-state so the audit row records what is being undone.
    const prev = await qbReconRepository.getReconIgnoreById(id);
    if (!prev) return res.status(404).json({ error: "not_found" });
    await qbReconRepository.softDeleteReconIgnore(id);
    await logAuditFromReq(req, {
      entityType: "qb_recon_ignore",
      entityId: String(id),
      action: "delete",
      changesJson: {
        previous_state: {
          qbBillId: prev.qbBillId,
          qbDocNumber: prev.qbDocNumber,
          reason: prev.reason,
          ignoredByName: prev.ignoredByName,
        },
        new_state: null,
        reason: body.reason,
      },
      projectName: prev.resolvedProjectName ?? undefined,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[tracker-gap/ignore/delete]", err);
    res.status(500).json({ error: "ignore_delete_failed", detail: "An unexpected server error occurred" });
  }
});

const overrideBodySchema = z.object({
  classRefName: z.string().min(1).max(200),
  projectName: z.string().min(1).max(200),
  // Mandatory rationale per COS hardening brief — every QB class→project mapping must record
  // *why* it was created so the override trail is auditable, not just *who*.
  note: z.string().min(1).max(500),
});

router.post("/api/cos-tracker/tracker-gap/class-override", requireAuth, requirePermission("cos", "edit"), validateBody(overrideBodySchema), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof overrideBodySchema>;
    const user = (req as any).user;
    // Atomic supersede: soft-delete any active row for this class then insert, all in one tx.
    // The partial unique index on LOWER(class_ref_name) WHERE deleted_at IS NULL means a concurrent
    // writer can still trip 23505; we surface that as 409 so the client can retry deterministically.
    const created = await qbReconRepository.supersedeAndInsertClassOverride({
      classRefName: body.classRefName,
      projectName: body.projectName,
      note: body.note ?? null,
      createdByUserId: user?.id ?? null,
      createdByName: user?.name ?? user?.email ?? null,
    });
    await logAuditFromReq(req, {
      entityType: "qb_class_project_override",
      entityId: String(created.id),
      action: "create",
      changesJson: {
        previous_state: null,
        new_state: { classRefName: body.classRefName, projectName: body.projectName },
        reason: body.note,
      },
      projectName: body.projectName,
    });
    res.json({ ok: true, override: created });
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === "23505") {
      console.warn("[tracker-gap/class-override] concurrent insert collided", err?.message);
      return res.status(409).json({ error: "concurrent_update", detail: "Another mapping was just saved for this class. Refresh and retry." });
    }
    console.error("[tracker-gap/class-override]", err);
    res.status(500).json({ error: "override_failed", detail: "An unexpected server error occurred" });
  }
});

const overrideUndoBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

router.delete("/api/cos-tracker/tracker-gap/class-override/:id", requireAuth, requirePermission("cos", "edit"), validateBody(overrideUndoBodySchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
    const body = req.body as z.infer<typeof overrideUndoBodySchema>;
    const prev = await qbReconRepository.getClassOverrideById(id);
    if (!prev) return res.status(404).json({ error: "not_found" });
    await qbReconRepository.softDeleteClassOverride(id);
    await logAuditFromReq(req, {
      entityType: "qb_class_project_override",
      entityId: String(id),
      action: "delete",
      changesJson: {
        previous_state: { classRefName: prev.classRefName, projectName: prev.projectName, note: prev.note },
        new_state: null,
        reason: body.reason,
      },
      projectName: prev.projectName,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[tracker-gap/class-override/delete]", err);
    res.status(500).json({ error: "override_delete_failed", detail: "An unexpected server error occurred" });
  }
});

// =====================================================================
// REVENUE Tracker-Gap maintenance workspace (Task #18 — mirrors COS).
//
// Same architecture as the COS endpoints above, but works on QuickBooks
// Invoices + Customers instead of Bills + Classes, and writes to
// qb_revenue_recon_ignores / qb_customer_project_overrides.
// READ-ONLY against `normalized_revenue_lines` / `quickbooks_invoice_links`.
// =====================================================================

/**
 * Reads revenue lines for a specific project using the SAME data source as the
 * portfolio routes. This ensures project-level and portfolio-level views produce
 * identical per-project revenue totals (including revenue_recognition_amount).
 *
 * The portfolio route reads all lines via getAllRevenueLinesForCashflow() and
 * filters by normalized project name. The legacy per-project call
 * (getProgramInflowsByProject) uses an exact SQL string match which can miss
 * variant names (e.g. "Mondi_Tracker" vs "Mondi"). Read-only.
 */
async function getProjectRevenueLinesConsistent(projectName: string): Promise<any[]> {
  const allInflows = await storage.getAllRevenueLinesForCashflow();
  const normalizedTarget = (projectName || "").replace(/_Tracker$/i, "").trim().toLowerCase();
  return allInflows.filter((r: any) => {
    const rName = ((r.projectName as string) || "").replace(/_Tracker$/i, "").trim().toLowerCase();
    return rName === normalizedTarget;
  });
}

router.get(
  "/api/revenue-tracker/tracker-gap",
  requireAuth,
  requirePermission("revenue_tracker", "edit"),
  async (req, res) => {
    try {
      const start = String(req.query.start || "");
      const end = String(req.query.end || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return res.status(400).json({ error: "start and end required as YYYY-MM-DD" });
      }

      const [projects, nrl, custOverrides, ignores] = await Promise.all([
        projectInfoRepository.listAllProjectNames(),
        financeInflowsRepository.listActiveRevenueLineProjectNames(),
        qbReconRepository.listActiveCustomerOverrides(),
        qbReconRepository.listActiveRevenueReconIgnores(),
      ]);

      const universe = new Set<string>();
      for (const p of projects) if (p.name) universe.add(p.name);
      for (const r of nrl) if (r.name) universe.add(r.name);
      const projectNames = [...universe];

      const overrideByCustomer = new Map<string, string>();
      for (const o of custOverrides) {
        overrideByCustomer.set(o.customerRefName.toLowerCase().trim(), o.projectName);
      }

      const ignoreKey = (invoiceId: string | null, lineId: string | null) =>
        `${invoiceId ?? ""}::${lineId ?? ""}`;

      const activeRevLines = await financeInflowsRepository.listActiveRevenueLinesForTrackerGap();
      const revLinesByProjectKey = new Map<string, typeof activeRevLines>();
      for (const rl of activeRevLines) {
        const key = normalizeProjectKey(rl.projectName);
        if (!key) continue;
        if (!revLinesByProjectKey.has(key)) revLinesByProjectKey.set(key, []);
        revLinesByProjectKey.get(key)!.push(rl);
      }

      let invoicesResp: { QueryResponse?: { Invoice?: unknown[] } } | undefined;
      try {
        invoicesResp = await getInvoices(start, end);
      } catch (qbErr) {
        console.error("[revenue tracker-gap] QB getInvoices failed:", qbErr);
        return res.status(503).json({
          error: "qb_not_connected",
          detail: "QuickBooks integration is unavailable. Reconnect QB to refresh the gap report.",
          message: qbErr instanceof Error ? qbErr.message : String(qbErr),
        });
      }
      const invoices: unknown[] = invoicesResp?.QueryResponse?.Invoice ?? [];

      // Revenue resolution prioritises CUSTOMER over CLASS (opposite of COS).
      const resolveProject = buildRevenueProjectResolver(projectNames);

      type GapBucket = "tracker_gap" | "unmapped_customer" | "unmapped_no_customer" | "matched" | "fuzzy";
      interface GapRow {
        bucket: GapBucket;
        invoiceId: string | null;
        qbLineId: string | null;
        docNumber: string | null;
        txnDate: string | null;
        customerName: string | null;
        lineAmountExVat: number | null;
        classRefName: string | null;
        itemRefName: string | null;
        description: string | null;
        balance: number | null;
        resolvedProjectName: string | null;
        strategy: string;
        matchedFrom: string | null;
        isOverride: boolean;
        isIgnored: boolean;
        ignoreReason: string | null;
        ignoredByName: string | null;
        ignoredAt: string | null;
        closestRevenueLineId: number | null;
      }

      const ignoreMeta = new Map<string, { reason: string; ignoredByName: string | null; ignoredAt: string }>();
      for (const ig of ignores) {
        ignoreMeta.set(ignoreKey(ig.qbInvoiceId, ig.qbLineId), {
          reason: ig.reason,
          ignoredByName: ig.ignoredByName,
          ignoredAt: ig.ignoredAt.toISOString(),
        });
      }

      const rows: GapRow[] = [];
      for (const inv of invoices) {
        for (const lr of invoiceRawToLineRows(inv)) {
          let resolution: QbProjectResolution = resolveProject({
            classRefName: lr.classRefName,
            customerRefName: lr.customerName,
          });
          let isOverride = false;
          if (!resolution.projectName && lr.customerName) {
            const override = overrideByCustomer.get(lr.customerName.toLowerCase().trim());
            if (override) {
              resolution = {
                projectName: override,
                strategy: "customer_override",
                matchedFrom: lr.customerName,
              };
              isOverride = true;
            }
          }

          let closestId: number | null = null;
          if (resolution.projectName) {
            const candidates = revLinesByProjectKey.get(normalizeProjectKey(resolution.projectName)) ?? [];
            const target = lr.lineAmountExVat ?? 0;
            type Cand = (typeof candidates)[number];
            const close = candidates
              .map((c: Cand) => ({ c, diff: Math.abs(Number(c.amountExVat ?? 0) - target) }))
              .filter((x: { diff: number }) => x.diff <= 1)
              .sort((a: { diff: number }, b: { diff: number }) => a.diff - b.diff)[0];
            if (close) closestId = close.c.id;
          }

          let bucket: GapBucket;
          if (resolution.projectName && closestId) bucket = "matched";
          else if (resolution.projectName) bucket = "tracker_gap";
          else if (lr.customerName) bucket = "unmapped_customer";
          else bucket = "unmapped_no_customer";

          const igk = ignoreKey(lr.invoiceId, lr.lineId);
          const ig = ignoreMeta.get(igk);

          rows.push({
            bucket,
            invoiceId: lr.invoiceId,
            qbLineId: lr.lineId,
            docNumber: lr.docNumber,
            txnDate: lr.txnDate,
            customerName: lr.customerName,
            lineAmountExVat: lr.lineAmountExVat,
            classRefName: lr.classRefName,
            itemRefName: lr.itemRefName,
            description: lr.description,
            balance: lr.balance,
            resolvedProjectName: resolution.projectName,
            strategy: resolution.strategy,
            matchedFrom: resolution.matchedFrom,
            isOverride,
            isIgnored: !!ig,
            ignoreReason: ig?.reason ?? null,
            ignoredByName: ig?.ignoredByName ?? null,
            ignoredAt: ig?.ignoredAt ?? null,
            closestRevenueLineId: closestId,
          });
        }
      }

      let totalAmount = 0;
      let openTrackerGapAmount = 0;
      let openTrackerGapCount = 0;
      let ignoredAmount = 0;
      let ignoredCount = 0;
      const byBucket: Record<GapBucket, { count: number; amount: number; openCount: number; openAmount: number }> = {
        tracker_gap: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
        unmapped_customer: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
        unmapped_no_customer: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
        matched: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
        fuzzy: { count: 0, amount: 0, openCount: 0, openAmount: 0 },
      };
      for (const r of rows) {
        const amt = r.lineAmountExVat ?? 0;
        totalAmount += amt;
        byBucket[r.bucket].count += 1;
        byBucket[r.bucket].amount += amt;
        if (!r.isIgnored) {
          byBucket[r.bucket].openCount += 1;
          byBucket[r.bucket].openAmount += amt;
        } else {
          ignoredAmount += amt;
          ignoredCount += 1;
        }
        if (r.bucket === "tracker_gap" && !r.isIgnored) {
          openTrackerGapAmount += amt;
          openTrackerGapCount += 1;
        }
      }

      const byProject = new Map<string, { project: string; count: number; openCount: number; amount: number; openAmount: number }>();
      for (const r of rows) {
        if (r.bucket !== "tracker_gap") continue;
        const key = r.resolvedProjectName ?? "(unknown)";
        if (!byProject.has(key)) byProject.set(key, { project: key, count: 0, openCount: 0, amount: 0, openAmount: 0 });
        const slot = byProject.get(key)!;
        slot.count += 1;
        slot.amount += r.lineAmountExVat ?? 0;
        if (!r.isIgnored) {
          slot.openCount += 1;
          slot.openAmount += r.lineAmountExVat ?? 0;
        }
      }

      const unmappedCustomerMap = new Map<string, { customerName: string; count: number; amount: number; sampleClasses: Set<string>; sampleItems: Set<string> }>();
      for (const r of rows) {
        if (r.bucket !== "unmapped_customer" || !r.customerName) continue;
        if (!unmappedCustomerMap.has(r.customerName))
          unmappedCustomerMap.set(r.customerName, { customerName: r.customerName, count: 0, amount: 0, sampleClasses: new Set(), sampleItems: new Set() });
        const slot = unmappedCustomerMap.get(r.customerName)!;
        slot.count += 1;
        slot.amount += r.lineAmountExVat ?? 0;
        if (r.classRefName) slot.sampleClasses.add(r.classRefName);
        if (r.itemRefName) slot.sampleItems.add(r.itemRefName);
      }
      // Per-customer suggestion engine — ranked candidates for each unmapped
      // customer. Scoring blends prior overrides for the same customer (rare
      // but strongest signal), normalised name overlap with project names,
      // and amount-window co-occurrence with active revenue lines.
      const customerAmountsMap = new Map<string, number[]>();
      for (const r of rows) {
        if (r.bucket !== "unmapped_customer" || !r.customerName) continue;
        if (!customerAmountsMap.has(r.customerName)) customerAmountsMap.set(r.customerName, []);
        customerAmountsMap.get(r.customerName)!.push(r.lineAmountExVat ?? 0);
      }
      const overridesByCustomerHistory = new Map<string, { projectName: string }[]>();
      for (const o of custOverrides) {
        const k = o.customerRefName.toLowerCase().trim();
        if (!overridesByCustomerHistory.has(k)) overridesByCustomerHistory.set(k, []);
        overridesByCustomerHistory.get(k)!.push({ projectName: o.projectName });
      }
      const unmappedCustomerList = [...unmappedCustomerMap.values()]
        .map((v) => ({
          customerName: v.customerName,
          count: v.count,
          amount: Math.round(v.amount * 100) / 100,
          sampleClasses: [...v.sampleClasses].slice(0, 5),
          sampleItems: [...v.sampleItems].slice(0, 5),
          suggestions: rankRevenueProjectSuggestions({
            customerName: v.customerName,
            customerAmounts: customerAmountsMap.get(v.customerName) ?? [],
            projectNames,
            revenueLinesByProjectKey: revLinesByProjectKey,
            priorOverridesForCustomer: overridesByCustomerHistory.get(v.customerName.toLowerCase().trim()) ?? [],
          }),
        }))
        .sort((a, b) => b.amount - a.amount);

      res.json({
        generatedAt: new Date().toISOString(),
        window: { start, end },
        summary: {
          totalLineRows: rows.length,
          totalAmountExVat: Math.round(totalAmount * 100) / 100,
          openTrackerGapCount,
          openTrackerGapAmountExVat: Math.round(openTrackerGapAmount * 100) / 100,
          ignoredCount,
          ignoredAmountExVat: Math.round(ignoredAmount * 100) / 100,
          projectUniverseSize: projectNames.length,
          customerOverridesActive: custOverrides.length,
        },
        byBucket: Object.fromEntries(
          Object.entries(byBucket).map(([k, v]) => [
            k,
            {
              count: v.count,
              amount: Math.round(v.amount * 100) / 100,
              openCount: v.openCount,
              openAmount: Math.round(v.openAmount * 100) / 100,
            },
          ]),
        ),
        byProject: [...byProject.values()].sort((a: any, b: any) => b.openAmount - a.openAmount),
        unmappedCustomers: unmappedCustomerList,
        customerOverrides: custOverrides.map((o: any) => ({
          id: o.id,
          customerRefName: o.customerRefName,
          projectName: o.projectName,
          note: o.note,
          createdByName: o.createdByName,
          createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
        })),
        rows,
      });
    } catch (err) {
      console.error("[revenue tracker-gap]", err);
      res.status(500).json({ error: "revenue_tracker_gap_failed", detail: "An unexpected server error occurred" });
    }
  },
);

const revenueIgnoreBodySchema = z.object({
  qbInvoiceId: z.string().min(1),
  qbLineId: z.string().nullable().optional(),
  qbDocNumber: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  lineAmountExVat: z.number().nullable().optional(),
  resolvedProjectName: z.string().nullable().optional(),
  reason: z.string().min(1).max(500),
});

router.post(
  "/api/revenue-tracker/tracker-gap/ignore",
  requireAuth,
  requirePermission("revenue_tracker", "edit"),
  validateBody(revenueIgnoreBodySchema),
  async (req, res) => {
    try {
      const body = req.body as z.infer<typeof revenueIgnoreBodySchema>;
      const user = req.user;
      const created = await qbReconRepository.createRevenueReconIgnore({
        qbInvoiceId: body.qbInvoiceId,
        qbLineId: body.qbLineId ?? null,
        qbDocNumber: body.qbDocNumber ?? null,
        customerName: body.customerName ?? null,
        lineAmountExVat: body.lineAmountExVat != null ? String(body.lineAmountExVat) : null,
        resolvedProjectName: body.resolvedProjectName ?? null,
        reason: body.reason,
        ignoredByUserId: user?.id ?? null,
        ignoredByName: user?.name ?? user?.email ?? null,
      });
      // Audit entityId is the (qbInvoiceId,qbLineId) composite — not the
      // ignore-table row id — so the maintenance UI can look up history by
      // the same key it already has on every gap row. Format mirrors the COS
      // workspace convention: "<invoiceId>:<lineId or _>".
      const ignoreAuditEntityId = `${body.qbInvoiceId}:${body.qbLineId ?? "_"}`;
      await logAuditFromReq(req, {
        entityType: "qb_revenue_recon_ignore",
        entityId: ignoreAuditEntityId,
        action: "create",
        changesJson: {
          ignoreRowId: created.id,
          previous_state: null,
          new_state: {
            qbInvoiceId: body.qbInvoiceId,
            qbLineId: body.qbLineId ?? null,
            qbDocNumber: body.qbDocNumber ?? null,
            customerName: body.customerName ?? null,
            lineAmountExVat: body.lineAmountExVat ?? null,
            resolvedProjectName: body.resolvedProjectName ?? null,
          },
          reason: body.reason,
        },
        projectName: body.resolvedProjectName ?? undefined,
      });
      res.json({ ok: true, ignore: created });
    } catch (err) {
      console.error("[revenue tracker-gap/ignore]", err);
      res.status(500).json({ error: "ignore_failed", detail: "An unexpected server error occurred" });
    }
  },
);

const revenueIgnoreUndoBodySchema = z.object({ reason: z.string().min(1).max(500) });

router.delete(
  "/api/revenue-tracker/tracker-gap/ignore/:id",
  requireAuth,
  requirePermission("revenue_tracker", "edit"),
  validateBody(revenueIgnoreUndoBodySchema),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
      const body = req.body as z.infer<typeof revenueIgnoreUndoBodySchema>;
      const prev = await qbReconRepository.getRevenueReconIgnoreById(id);
      if (!prev) return res.status(404).json({ error: "not_found" });
      await qbReconRepository.softDeleteRevenueReconIgnore(id);
      const undoAuditEntityId = `${prev.qbInvoiceId}:${prev.qbLineId ?? "_"}`;
      await logAuditFromReq(req, {
        entityType: "qb_revenue_recon_ignore",
        entityId: undoAuditEntityId,
        action: "delete",
        changesJson: {
          ignoreRowId: id,
          previous_state: {
            qbInvoiceId: prev.qbInvoiceId,
            qbLineId: prev.qbLineId,
            qbDocNumber: prev.qbDocNumber,
            reason: prev.reason,
            ignoredByName: prev.ignoredByName,
          },
          new_state: null,
          reason: body.reason,
        },
        projectName: prev.resolvedProjectName ?? undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[revenue tracker-gap/ignore/delete]", err);
      res.status(500).json({ error: "ignore_delete_failed", detail: "An unexpected server error occurred" });
    }
  },
);

const customerOverrideBodySchema = z.object({
  customerRefName: z.string().min(1).max(200),
  projectName: z.string().min(1).max(200),
  note: z.string().min(1).max(500),
});

router.post(
  "/api/revenue-tracker/tracker-gap/customer-override",
  requireAuth,
  requirePermission("revenue_tracker", "edit"),
  validateBody(customerOverrideBodySchema),
  async (req, res) => {
    try {
      const body = req.body as z.infer<typeof customerOverrideBodySchema>;
      const user = req.user;
      const created = await qbReconRepository.supersedeAndInsertCustomerOverride({
        customerRefName: body.customerRefName,
        projectName: body.projectName,
        note: body.note ?? null,
        createdByUserId: user?.id ?? null,
        createdByName: user?.name ?? user?.email ?? null,
      });
      await logAuditFromReq(req, {
        entityType: "qb_customer_project_override",
        entityId: String(created.id),
        action: "create",
        changesJson: {
          previous_state: null,
          new_state: { customerRefName: body.customerRefName, projectName: body.projectName },
          reason: body.note,
        },
        projectName: body.projectName,
      });
      res.json({ ok: true, override: created });
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      const code = e?.code ?? e?.cause?.code;
      if (code === "23505") {
        return res.status(409).json({ error: "concurrent_update", detail: "Another mapping was just saved for this customer. Refresh and retry." });
      }
      console.error("[revenue tracker-gap/customer-override]", err);
      res.status(500).json({ error: "override_failed", detail: "An unexpected server error occurred" });
    }
  },
);

router.delete(
  "/api/revenue-tracker/tracker-gap/customer-override/:id",
  requireAuth,
  requirePermission("revenue_tracker", "edit"),
  validateBody(z.object({ reason: z.string().min(1).max(500) })),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
      const body = req.body as { reason: string };
      const prev = await qbReconRepository.getCustomerOverrideById(id);
      if (!prev) return res.status(404).json({ error: "not_found" });
      await qbReconRepository.softDeleteCustomerOverride(id);
      await logAuditFromReq(req, {
        entityType: "qb_customer_project_override",
        entityId: String(id),
        action: "delete",
        changesJson: {
          previous_state: { customerRefName: prev.customerRefName, projectName: prev.projectName, note: prev.note },
          new_state: null,
          reason: body.reason,
        },
        projectName: prev.projectName,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[revenue tracker-gap/customer-override/delete]", err);
      res.status(500).json({ error: "override_delete_failed", detail: "An unexpected server error occurred" });
    }
  },
);

// Revenue audit-history viewer (mirrors /api/cos-tracker/audit-history).
router.get(
  "/api/revenue-tracker/audit-history",
  requireAuth,
  requirePermission("revenue_tracker", "edit"),
  async (req, res) => {
    try {
      const schema = z.object({
        entityType: z.enum([
          "qb_revenue_recon_ignore",
          "qb_customer_project_override",
          "quickbooks_invoice_link",
          "normalized_revenue_line",
          "revenue_line",
        ]),
        entityId: z.string().min(1).max(100),
      });
      const parsed = schema.safeParse({ entityType: req.query.entityType, entityId: req.query.entityId });
      if (!parsed.success) return res.status(400).json({ error: "invalid_query", detail: parsed.error.format() });
      const { entityType, entityId } = parsed.data;
      const events = await qbReconRepository.listEntityAuditEvents(entityType, entityId, 200);
      res.json({
        entityType,
        entityId,
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          actorRole: e.actorRole,
          userName: e.userName,
          userId: e.userId,
          source: e.source,
          changes: e.changesJson,
          projectName: e.projectName,
          createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
        })),
      });
    } catch (err) {
      console.error("[revenue tracker-gap/audit-history]", err);
      res.status(500).json({ error: "audit_history_failed", detail: "An unexpected server error occurred" });
    }
  },
);

/**
 * Audit-history viewer for any tracker-gap or COS reconciliation entity. Returns up to 200 of the
 * most-recent `audit_events` rows for the given entityType+entityId, newest-first, so the UI can
 * render a "what happened to this row" timeline (link / unlink / ignore / override / undo). The
 * client is responsible for reversing the order if it wants oldest-first display.
 *
 * Permission mirrors the maintenance workspace itself (`cos:edit`) so site-leads can self-audit
 * their own actions; senior finance/admin retain full read-anywhere via the audit explorer.
 */
const auditHistoryQuerySchema = z.object({
  entityType: z.enum([
    "qb_recon_ignore",
    "qb_class_project_override",
    "quickbooks_invoice_link",
    "normalized_cost_line",
    "cost_line",
  ]),
  entityId: z.string().min(1).max(100),
});

router.get("/api/cos-tracker/audit-history", requireAuth, requirePermission("cos", "edit"), async (req, res) => {
  try {
    const parsed = auditHistoryQuerySchema.safeParse({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", detail: parsed.error.format() });
    }
    const { entityType, entityId } = parsed.data;
    const events = await qbReconRepository.listEntityAuditEvents(entityType, entityId, 200);
    res.json({
      entityType,
      entityId,
      count: events.length,
      events: events.map((e: any) => ({
        id: e.id,
        action: e.action,
        actorRole: e.actorRole,
        userName: e.userName,
        userId: e.userId,
        source: e.source,
        changes: e.changesJson,
        projectName: e.projectName,
        requestPath: e.requestPath,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
      })),
    });
  } catch (err) {
    console.error("[cos-tracker/audit-history]", err);
    res.status(500).json({ error: "audit_history_failed", detail: "An unexpected server error occurred" });
  }
});

router.get("/api/cos-tracker/reconciliation", requireAuth, async (req, res) => {
  try {
    const { monthKey } = req.query as { monthKey?: string };
    const [allCostLines, links, rawBills] = await Promise.all([
      financeExpenseRepository.listAllActiveCostLines(),
      qbLinksRepository.listActiveLinksByPair("cost_line", "bill"),
      getBills("2025-09-01", "2026-08-31").catch(() => ({ QueryResponse: { Bill: [] } })),
    ]);

    const bills = (rawBills?.QueryResponse?.Bill ?? []).map(billRawToSummary);
    const billById = new Map<string, any>(bills.map((b: any) => [String(b.id), b]));
    // Task #142 multimap.
    const linkByCost = new Map<number, any[]>();
    for (const l of links as any[]) {
      const arr = linkByCost.get(l.appEntityId) ?? [];
      arr.push(l);
      linkByCost.set(l.appEntityId, arr);
    }
    const linkedBillIds = new Set<string>(links.map((l: any) => String(l.qbEntityId)));
    const recRows: Array<any> = [];

    const reasonCodesFor = (row: any, bill: any) => {
      const codes: string[] = [];
      if (!row?.poNumber) codes.push("Missing PO");
      if (!row?.invoiceNumber) codes.push("Missing invoice number");
      const rowProj = String(row?.projectName || "").trim();
      if (!rowProj) codes.push("Project mapping missing");
      const rowSupplier = String(row?.counterpartyName || "").trim().toLowerCase();
      const billSupplier = String(bill?.vendorName || "").trim().toLowerCase();
      if (rowSupplier && billSupplier && rowSupplier !== billSupplier) codes.push("Supplier mismatch");
      const rowMonth = String(row?.invoiceDate || "").slice(0, 7);
      const billMonth = String(bill?.txnDate || "").slice(0, 7);
      if (rowMonth && billMonth && rowMonth !== billMonth) codes.push("Posted to wrong month");
      const rowAmt = Number(row?.amountExVat ?? 0);
      const billAmt = Number(bill?.totalAmount ?? 0);
      if (rowAmt && billAmt && Math.abs(rowAmt - billAmt) > 1) codes.push("Amount mismatch");
      return codes;
    };

    for (const row of allCostLines as any[]) {
      const siblings = linkByCost.get(row.id) ?? [];
      const link = siblings[0];
      const bill = link ? billById.get(String(link.qbEntityId)) : null;
      const month = String(bill?.txnDate || row.invoiceDate || "").slice(0, 7);
      if (!month) continue;
      if (monthKey && month !== monthKey) continue;
      const reasons = link ? reasonCodesFor(row, bill) : reasonCodesFor(row, null);
      const tab = link ? (reasons.length ? "exceptions" : "matched") : "app_only";
      // Task #142 — sum the allocations attributed to THIS app cost line
      // across its sibling links so we don't credit a multi-line bill's
      // total to every linked app row.
      const allocatedQbAmount = siblings.reduce(
        (acc: number, l: any) =>
          acc +
          (effectiveAllocatedAmountExVat({
            allocatedAmountExVat: l.allocatedAmountExVat ?? null,
            qbAmount: l.qbAmount ?? null,
          }) ?? 0),
        0,
      );
      recRows.push({
        month,
        project: (row.projectName || "").replace(/_Tracker$/i, "") || "Unknown Project",
        appAmount: Number(row.amountExVat || 0),
        qbAmount: link ? Number(allocatedQbAmount) : 0,
        appId: row.id,
        qbId: bill?.id ?? null,
        matchStatus: link ? "matched" : "app_only",
        tab,
        reasonCodes: link ? reasons : [...new Set(["Sync error", ...reasons])],
        poNumber: row.poNumber || null,
        invoiceNumber: row.invoiceNumber || null,
      });
    }

    for (const bill of bills as any[]) {
      if (linkedBillIds.has(String(bill.id))) continue;
      const month = String(bill.txnDate || "").slice(0, 7);
      if (!month) continue;
      if (monthKey && month !== monthKey) continue;
      recRows.push({
        month,
        project: "Unmapped QB Bill",
        appAmount: 0,
        qbAmount: Number(bill.totalAmount || 0),
        appId: null,
        qbId: bill.id,
        matchStatus: "qb_only",
        tab: "qb_only",
        reasonCodes: ["Project mapping missing", "Sync error"],
        poNumber: null,
        invoiceNumber: bill.docNumber || null,
      });
    }

    const summaryMap = new Map<string, any>();
    for (const row of recRows) {
      const key = `${row.month}::${row.project}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          month: row.month,
          project: row.project,
          appActual: 0,
          qbActual: 0,
          appOnlyItemCount: 0,
          qbOnlyItemCount: 0,
          missingPoCount: 0,
          missingInvoiceCount: 0,
        });
      }
      const s = summaryMap.get(key)!;
      s.appActual += row.appAmount;
      s.qbActual += row.qbAmount;
      if (row.matchStatus === "app_only") s.appOnlyItemCount++;
      if (row.matchStatus === "qb_only") s.qbOnlyItemCount++;
      if (row.reasonCodes.includes("Missing PO")) s.missingPoCount++;
      if (row.reasonCodes.includes("Missing invoice number")) s.missingInvoiceCount++;
    }

    const summary = Array.from(summaryMap.values()).map((s: any) => {
      const delta = s.appActual - s.qbActual;
      const deltaPct = s.qbActual !== 0 ? (delta / s.qbActual) * 100 : 0;
      const status = Math.abs(deltaPct) <= 2 ? "Matched" : Math.abs(deltaPct) <= 10 ? "Investigate" : "Exception";
      return { ...s, delta, deltaPct, status };
    });

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines",
      derivedTable: "quickbooks_invoice_links",
    });
    res.json({
      summary,
      tabs: {
        matched: recRows.filter((r) => r.tab === "matched"),
        appOnly: recRows.filter((r) => r.tab === "app_only"),
        qbOnly: recRows.filter((r) => r.tab === "qb_only"),
        exceptions: recRows.filter((r) => r.tab === "exceptions"),
      },
    });
  } catch (error) {
    console.error("COS reconciliation error:", error);
    res.status(500).json({ error: "Failed to fetch COS reconciliation" });
  }
});

async function updateExpenseFieldsDualTable(
  id: number,
  fields: Record<string, any>,
  expectedUpdatedAt?: string,
  editorUserId?: number | null,
): Promise<any> {
  // All expense IDs now route through normalized_cost_lines (canonical source).
  // Negative IDs (from adaptCostToExpense) and legacy 900000-offset IDs are
  // both handled by storage.updateProgramExpenseFields which reverses the offset.
  // Positive PE-only IDs are no longer supported for writes — PE is deprecated for writes.
  const isNormalized = id < 0 || id >= 900000;
  if (isNormalized) {
    return storage.updateProgramExpenseFields(id, fields, expectedUpdatedAt);
  }
  // Legacy PE-only row: log deprecation warning and attempt NCL lookup by ID
  console.warn(`[deprecation] updateExpenseFieldsDualTable called with legacy PE id=${id}. PE writes are deprecated.`);
  return storage.updateProgramExpenseFields(id, fields, expectedUpdatedAt);
}

router.patch("/api/cos-tracker/toggle-realised/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });

    const { realised, expectedUpdatedAt } = req.body as { realised: boolean; expectedUpdatedAt?: string };
    if (typeof realised !== 'boolean') return res.status(400).json({ error: "realised (boolean) required" });

    const allExpenses = await storage.getAllCostLinesForCashflow();
    const expense = allExpenses.find(e => e.id === id);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    // B5 (audit closeout): COS period lock check. Before we touch any
    // recognition flag we must confirm the affected period is not locked.
    // The effective month for a cost line is derived from the invoice
    // date (preferred) or the payment date. If the row falls into a
    // locked month:
    //   - COO / CFO / CEO callers may proceed (bypass logged to audit)
    //   - Everyone else gets 423 Locked with the period details
    const effectiveDateForLock =
      expense.expenseInvoicedDate || (expense as any).expensePaymentDate || null;
    const lockStatus = await checkCosPeriodLock({
      effectiveDate: effectiveDateForLock,
      role: req.user?.role,
    });
    if (lockStatus?.locked && !lockStatus.canOverride) {
      return res.status(423).json({
        error: "period_locked",
        period: lockStatus.period,
        lockedAt: lockStatus.lockedAt,
        message: `COS period ${lockStatus.period} is locked. Only COO / CFO / CEO can modify cost lines dated in this month. Either wait for a manager to unlock the period or ask them to make the change.`,
      });
    }
    if (lockStatus?.locked && lockStatus.canOverride) {
      logAuditFromReq(req, {
        entityType: "normalized_cost_line",
        entityId: String(id),
        action: "cos.locked_period_override",
        projectName: (expense as any).projectName ?? null,
        changesJson: {
          period: lockStatus.period,
          reason: "realised flag toggled under locked-period override",
          effectiveDate: effectiveDateForLock,
          lockedAt: lockStatus.lockedAt,
          overriddenByUserId: req.user?.id ?? null,
          overriddenByRole: req.user?.role ?? null,
        },
      });
    }

    // B4 (audit closeout): COS recognition requires linked invoice evidence.
    // The normal path enforces THREE things:
    //   1. invoice number must be present
    //   2. invoice number must NOT be a placeholder (TBC, pending, n/a, etc.)
    //   3. invoice date must be present
    // If any of these are missing the caller must go through the override
    // endpoint /api/cos-tracker/override-status/:id which requires a
    // mandatory reason and the broader role whitelist (COO/CFO/PFM/CEO).
    if (realised) {
      const invoiceNumber = String(expense.expenseInvoiceNumber || "").trim();
      if (!invoiceNumber) {
        return res.status(400).json({
          error: "missing_invoice_number",
          message:
            "Cannot mark as realised without a linked invoice number. If you need to recognise without evidence, use POST /api/cos-tracker/override-status/:id with a reason (COO / CFO / PFM / CEO only).",
        });
      }
      if (PLACEHOLDER_INVOICES.has(invoiceNumber.toLowerCase())) {
        return res.status(400).json({
          error: "placeholder_invoice_number",
          message: `Invoice number "${invoiceNumber}" is a placeholder. Replace it with the real supplier invoice number before marking as realised, or use the override path with a reason.`,
          placeholder: invoiceNumber,
        });
      }
      if (!expense.expenseInvoicedDate) {
        return res.status(400).json({
          error: "missing_invoice_date",
          message: "Cannot mark as realised without an invoice date.",
        });
      }
    }

    const updated = await updateExpenseFieldsDualTable(id, {
      invoiceDateConfirmed: realised,
    }, expectedUpdatedAt, req.user?.id ?? null);

    if (!updated) {
      return res.status(500).json({ error: "Failed to update expense fields" });
    }

    // B4: audit the realisation action so there's a per-line paper trail.
    logAuditFromReq(req, {
      entityType: "normalized_cost_line",
      entityId: String(id),
      action: realised ? "cos.realised_with_invoice" : "cos.unrealised",
      projectName: (expense as any).projectName ?? null,
      changesJson: {
        realised,
        invoiceNumber: expense.expenseInvoiceNumber ?? null,
        invoiceDate: expense.expenseInvoicedDate ?? null,
        projectId: (expense as any).projectId ?? null,
      },
    });

    res.json({ success: true, id, realised });

    if (expense.projectId) refreshProjectMetricsAsync(expense.projectId);
  } catch (error) {
    console.error("Toggle realised error:", error);
    res.status(500).json({ error: "Failed to toggle realised status" });
  }
});

// ==================== COS STATUS OVERRIDE (B4: broadened role whitelist) ====================
// Per B4 direction: "Admin override with reason — COO / CFO / PFM can
// force-recognise with a mandatory reason field, logged in the audit trail."
// Previously this endpoint was requireAdmin (COO_ADMIN / CEO_ADMIN only),
// which excluded the CFO and the Program Finance Manager who should both
// be empowered to override. The whitelist is now:
//   COO_ADMIN, CEO_ADMIN, CFO, PROGRAM_FINANCE_MANAGER

router.patch("/api/cos-tracker/override-status/:id", requireAuth, requireCosOverrideRole, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });

    const { cosStatus, invoiceDate, invoiceDateConfirmed: invoiceDateConfirmedOverride, reason, expectedUpdatedAt } = req.body as {
      cosStatus: string | null;
      invoiceDate?: string;
      invoiceDateConfirmed?: boolean;
      reason: string;
      expectedUpdatedAt?: string;
    };

    const validStatuses = ['Planned', 'Committed', 'COS Realised', null];
    if (!validStatuses.includes(cosStatus)) {
      return res.status(400).json({ error: "cosStatus must be 'Planned', 'Committed', 'COS Realised', or null (to clear override)" });
    }

    // B4: mandatory reason — the whole point of the override path is that
    // it writes an audit trail explaining WHY recognition diverged from
    // the evidence. A blank reason defeats the control.
    if (cosStatus !== null && (!reason || !reason.trim())) {
      return res.status(400).json({
        error: "missing_override_reason",
        message: "A reason is required when setting a COS override. This is a financial control — the audit trail must explain why recognition is diverging from the linked invoice evidence.",
      });
    }

    const allExpenses = await storage.getAllCostLinesForCashflow();
    const expense = allExpenses.find(e => e.id === id);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    // B5: period lock check also applies to the override path. The B4
    // whitelist (COO/CFO/PFM) is wider than the B5 bypass whitelist
    // (COO/CFO/CEO) — so a PFM attempting an override on a locked period
    // will be rejected with 423, not 403. They need a COO or CFO to
    // unlock the period first.
    const effectiveDateForLock =
      expense.expenseInvoicedDate || (expense as any).expensePaymentDate || null;
    const overrideLockStatus = await checkCosPeriodLock({
      effectiveDate: effectiveDateForLock,
      role: req.user?.role,
    });
    if (overrideLockStatus?.locked && !overrideLockStatus.canOverride) {
      return res.status(423).json({
        error: "period_locked",
        period: overrideLockStatus.period,
        lockedAt: overrideLockStatus.lockedAt,
        message: `COS period ${overrideLockStatus.period} is locked. The B4 override path is gated to COO / CFO / CEO when the period is locked (PFM cannot bypass a period lock). Ask a COO or CFO to unlock the period or make the change.`,
      });
    }
    if (overrideLockStatus?.locked && overrideLockStatus.canOverride) {
      logAuditFromReq(req, {
        entityType: "normalized_cost_line",
        entityId: String(id),
        action: "cos.locked_period_override",
        projectName: (expense as any).projectName ?? null,
        changesJson: {
          period: overrideLockStatus.period,
          reason: "cos status override applied under locked-period override",
          effectiveDate: effectiveDateForLock,
          lockedAt: overrideLockStatus.lockedAt,
          overriddenByUserId: req.user?.id ?? null,
          overriddenByRole: req.user?.role ?? null,
        },
      });
    }

    const previousOverride = (expense as any).cosStatusOverride ?? null;

    const overrideFields: Record<string, any> = {
      cosStatusOverride: cosStatus,
      cosStatusOverrideBy: cosStatus !== null ? req.user?.id ?? null : null,
      cosStatusOverrideAt: cosStatus !== null ? new Date() : null,
      cosStatusOverrideReason: cosStatus !== null ? reason : null,
    };

    if (invoiceDate !== undefined) {
      overrideFields.expenseInvoicedDate = invoiceDate;
    }
    if (invoiceDateConfirmedOverride !== undefined) {
      overrideFields.invoiceDateConfirmed = invoiceDateConfirmedOverride;
    }

    const updated = await updateExpenseFieldsDualTable(id, overrideFields, expectedUpdatedAt, req.user?.id ?? null);
    if (!updated) {
      return res.status(500).json({ error: "Failed to update expense fields" });
    }

    // B4: explicit audit-log entry tagged as override so downstream
    // monitoring can flag the "recognition without evidence" events.
    logAuditFromReq(req, {
      entityType: "normalized_cost_line",
      entityId: String(id),
      action: cosStatus === null ? "cos.override_cleared" : "cos.override_applied",
      projectName: (expense as any).projectName ?? null,
      changesJson: {
        previousOverride,
        newOverride: cosStatus,
        reason: cosStatus !== null ? reason : null,
        invoiceNumber: expense.expenseInvoiceNumber ?? null,
        invoiceDate: expense.expenseInvoicedDate ?? null,
        overriddenByUserId: req.user?.id ?? null,
        overriddenByRole: req.user?.role ?? null,
        projectId: (expense as any).projectId ?? null,
      },
    });

    res.json({ success: true, id, cosStatus, overrideCleared: cosStatus === null });

    if (expense.projectId) refreshProjectMetricsAsync(expense.projectId);
  } catch (error: any) {
    // 409 business conflict — user-authored message is safe to surface.
    if (error.status === 409) {
      // eslint-disable-next-line no-restricted-syntax -- intentional: 409 business error message is user-authored
      return res.status(409).json({ error: error.message });
    }
    console.error("COS status override error:", error);
    res.status(500).json({ error: "Failed to override COS status" });
  }
});

// ==================== COS PERIOD LOCKS (B5) ====================
//
// Three endpoints:
//   GET  /api/cos-periods/status                     — lock state for a range
//        of months, drives the padlock badges on the finance dashboards.
//   POST /api/cos-periods/:yyyyMm/lock                — manual lock. Gated
//        to PERIOD_LOCK_OVERRIDE_ROLES (COO_ADMIN, CEO_ADMIN, CFO).
//   POST /api/cos-periods/:yyyyMm/unlock              — manual unlock. Same
//        role whitelist. Requires a mandatory reason.
//
// Auto-lock happens via server/bootstrap/cos-period-lock-scheduler.ts on
// the 3rd business day of the following month. That path creates rows
// with auto_locked=true; these endpoints create/manipulate rows with
// auto_locked=false.

function requirePeriodLockRole(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role ?? "";
  if (PERIOD_LOCK_OVERRIDE_ROLES.has(role)) return next();
  return res.status(403).json({
    error: "forbidden",
    reason:
      "Only COO_ADMIN, CEO_ADMIN, or CFO can lock or unlock a COS period. PFM can override individual recognitions (B4) but cannot unlock a whole month.",
    eligibleRoles: Array.from(PERIOD_LOCK_OVERRIDE_ROLES),
  });
}

function parsePeriodParam(raw: string): string | null {
  // Accept YYYY-MM or YYYY-MM-DD; normalize to YYYY-MM-01.
  const trimmed = String(raw || "").trim();
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(trimmed);
  if (!m) return null;
  const [, y, mm] = m;
  const mNum = Number(mm);
  if (mNum < 1 || mNum > 12) return null;
  return `${y}-${mm}-01`;
}

router.get("/api/cos-periods/status", requireAuth, async (req, res) => {
  try {
    const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
    const toRaw = typeof req.query.to === "string" ? req.query.to : null;
    // Default: last 12 months through current month.
    const now = new Date();
    const thisMonth = firstOfMonthSast(now);
    const fallbackFrom = (() => {
      const y = Number(thisMonth.slice(0, 4));
      const m = Number(thisMonth.slice(5, 7));
      const prevY = m <= 12 ? (m === 1 ? y - 1 : y) : y;
      // 12 months back
      let fy = y;
      let fm = m - 11;
      while (fm < 1) { fm += 12; fy -= 1; }
      return `${fy}-${String(fm).padStart(2, "0")}-01`;
    })();

    const fromMonth = parsePeriodParam(fromRaw ?? fallbackFrom) ?? fallbackFrom;
    const toMonth = parsePeriodParam(toRaw ?? thisMonth) ?? thisMonth;

    const statuses = await getCosPeriodLockStatuses({ fromMonth, toMonth });
    res.json({ fromMonth, toMonth, periods: statuses });
  } catch (error: any) {
    console.error("COS period status error:", error);
    res.status(500).json({ error: "Failed to load COS period lock statuses" });
  }
});

router.post("/api/cos-periods/:yyyyMm/lock", requireAuth, requirePeriodLockRole, validateBody(cosPeriodLockSchema), async (req, res) => {
  try {
    const period = parsePeriodParam(String(req.params.yyyyMm));
    if (!period) return res.status(400).json({ error: "Invalid period. Expected YYYY-MM." });
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : null;

    // Idempotent: if there's already an active lock for this period,
    // return it without inserting a second row.
    const existing = await getCosPeriodLockStatuses({ fromMonth: period, toMonth: period });
    if (existing[0]?.locked) {
      return res.json({
        success: true,
        alreadyLocked: true,
        period,
        lockedAt: existing[0].lockedAt,
      });
    }

    const id = await lockCosPeriod({
      periodMonth: period,
      lockedByUserId: req.user?.id ?? null,
      autoLocked: false,
      notes,
    });

    logAuditFromReq(req, {
      entityType: "cos_period_lock",
      entityId: String(id),
      action: "cos_period.locked",
      changesJson: { period, autoLocked: false, notes, lockedByRole: req.user?.role ?? null },
    });

    res.json({ success: true, alreadyLocked: false, period, id });
  } catch (error: any) {
    console.error("COS period lock error:", error);
    res.status(500).json({ error: "Failed to lock COS period" });
  }
});

router.post("/api/cos-periods/:yyyyMm/unlock", requireAuth, requirePeriodLockRole, validateBody(cosPeriodLockSchema), async (req, res) => {
  try {
    const period = parsePeriodParam(String(req.params.yyyyMm));
    if (!period) return res.status(400).json({ error: "Invalid period. Expected YYYY-MM." });

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      return res.status(400).json({
        error: "missing_unlock_reason",
        message: "A reason is required to unlock a COS period. This is a financial control — the audit trail must explain why the month is being reopened.",
      });
    }

    const id = await unlockCosPeriod({
      periodMonth: period,
      unlockedByUserId: req.user?.id ?? null,
      reason,
    });
    if (!id) {
      return res.status(404).json({ error: "no_active_lock", period });
    }

    logAuditFromReq(req, {
      entityType: "cos_period_lock",
      entityId: String(id),
      action: "cos_period.unlocked",
      changesJson: { period, reason, unlockedByRole: req.user?.role ?? null },
    });

    res.json({ success: true, period, id });
  } catch (error: any) {
    console.error("COS period unlock error:", error);
    res.status(500).json({ error: "Failed to unlock COS period" });
  }
});

// ==================== NO REVENUE LINKED TOGGLE ====================

router.patch("/api/cost-lines/:id/no-revenue-linked", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid cost line id" });
    const { noRevenueLinked, expectedUpdatedAt } = req.body as { noRevenueLinked: boolean; expectedUpdatedAt?: string };
    if (typeof noRevenueLinked !== 'boolean') return res.status(400).json({ error: "noRevenueLinked (boolean) required" });
    await updateExpenseFieldsDualTable(id, { noRevenueLinked }, expectedUpdatedAt, req.user?.id ?? null);
    res.json({ success: true, id, noRevenueLinked });
  } catch (error: any) {
    // 409 business conflict — user-authored message is safe to surface.
    if (error.status === 409) {
      // eslint-disable-next-line no-restricted-syntax -- intentional: 409 business error message is user-authored
      return res.status(409).json({ error: error.message });
    }
    console.error("Toggle no-revenue-linked error:", error);
    res.status(500).json({ error: "Failed to toggle no-revenue-linked" });
  }
});

// ==================== REVENUE TRACKER ====================

router.get("/api/revenue-tracker/project/:projectName", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  try {
    const projectName = decodeURIComponent(String(req.params.projectName || ""));
    const projectIdParam = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
    const [projectExpenses, revLines, manualEntries] = await Promise.all([
      getHighRiskProjectCostReadRows(projectName, projectIdParam),
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
    // UTC anchor — must match `cosCurrentMonthKey` in /api/cos-tracker so the
    // same line classifies the same way in aggregate and per-project views.
    const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const revByMonth = new Map<string, number>();
    const realisedRevByMonth = new Map<string, number>();
    const itemsByMonth = new Map<string, any[]>();

    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      if (!cosDate) continue;
      const dateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      // § 3.3 fix: use the canonical per-line revenue recognition amount
      // persisted by the Smart Import normalizer on
      // normalized_cost_lines.revenue_recognition_amount (col U on the
      // Expenditure Breakdown sheet). The previous on-the-fly formula
      // `(amount / totalCOS) * totalMilestoneRevenue` was project-pooled
      // and under-counted YTD revenue by ~93% (R 4.18M vs R 54.5M actual)
      // because totalMilestoneRevenue summed only NRL milestones, which
      // are incomplete for many projects. Matches the canonical pattern
      // at L4893-4900.
      const revenueAmount = isNoRevLinked
        ? 0
        : (parseFloat((exp as any).revenueRecognitionAmount as string) || 0);

      revByMonth.set(monthKey, (revByMonth.get(monthKey) || 0) + revenueAmount);

      const cosRealised = isEffectivelyRealised(exp, monthKey, currentMonthKey);
      if (cosRealised) {
        realisedRevByMonth.set(monthKey, (realisedRevByMonth.get(monthKey) || 0) + revenueAmount);
      }

      if (!itemsByMonth.has(monthKey)) itemsByMonth.set(monthKey, []);
      itemsByMonth.get(monthKey)!.push({
        id: exp.id,
        canonicalLineKey: (exp as any).canonicalLineKey || null,
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

router.get("/api/gp-tracker", requireAuth, requirePermission("gp_tracker", "view"), async (req, res) => {
  try {
    const [allExpenses, allInflowsRaw, revManualEntries, cosManualEntries, cosOverrideMap] = await Promise.all([
      getHighRiskAllCostReadRows(),
      storage.getAllRevenueLinesForCashflow(),
      storage.getTrackerMonthlyManual('REV'),
      storage.getTrackerMonthlyManual('COS'),
      Promise.resolve(new Map()),
    ]);


    const revManualBudgetMap = new Map(revManualEntries.map(e => [e.monthKey, e.budget ? parseFloat(e.budget) : 0]));
    const cosManualBudgetMap = new Map(cosManualEntries.map(e => [e.monthKey, e.budget ? parseFloat(e.budget) : 0]));

    // Uses shared static COS budget from financeUtils.ts (single source of truth)
    function getCosBudget(monthKey: string): number {
      const manual = cosManualBudgetMap.get(monthKey);
      if (manual && manual !== 0) return manual;
      return STATIC_COS_BUDGET_FY26[monthKey] ?? 0;
    }

    // GP = Revenue - COS. Suspicious NULLs in either side silently deflate the
    // total. Count rows where amount is null but an invoice reference exists.
    let gpNullCount = 0;
    for (const rev of allInflowsRaw) {
      const rawAmt = (rev as any).milestoneAmount;
      const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
      const hasInvoice = !!((rev as any).invoiceNumber && String((rev as any).invoiceNumber).trim());
      if (!hasAmt && hasInvoice) gpNullCount += 1;
    }
    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const rawAmt = (exp as any).expenseActualTotal;
      const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
      const hasInvoice = !!((exp as any).expenseInvoiceNumber && String((exp as any).expenseInvoiceNumber).trim());
      if (!hasAmt && hasInvoice) gpNullCount += 1;
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
    // UTC anchor — must match `cosCurrentMonthKey` in /api/cos-tracker so the
    // same line classifies the same way in aggregate and per-project views.
    const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const cosByMonth = new Map<string, number>();
    const realisedCosByMonth = new Map<string, number>();
    const revByMonth = new Map<string, number>();
    const realisedRevByMonth = new Map<string, number>();
    const projectGpMap = new Map<string, { revenue: number; cos: number; gp: number; gpPct: number }>();

    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;
      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      if (!cosDate) continue;
      const dateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      const pName = (exp.projectName || "").replace(/_Tracker$/i, "");
      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      // § 3.3 fix: use the canonical per-line revenue recognition amount
      // persisted on normalized_cost_lines.revenue_recognition_amount.
      // The previous formula `(amount / totalCOSProject) * totalRevProject`
      // was project-pooled and under-counted portfolio YTD revenue by ~93%
      // because totalRevProject summed only NRL milestone rows.
      const revenueAmount = isNoRevLinked
        ? 0
        : (parseFloat((exp as any).revenueRecognitionAmount as string) || 0);

      cosByMonth.set(monthKey, (cosByMonth.get(monthKey) || 0) + amount);
      revByMonth.set(monthKey, (revByMonth.get(monthKey) || 0) + revenueAmount);

      const cosRealised = isEffectivelyRealised(exp, monthKey, currentMonthKey);
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

    // Sum totals from FY-filtered monthly data (not all-time project totals)
    const totalRevenue = months.reduce((s: number, m: any) => s + m.totalRevenue, 0);
    const totalCOS = months.reduce((s: number, m: any) => s + m.totalCOS, 0);
    const totalGP = totalRevenue - totalCOS;
    const overallGpPct = totalRevenue !== 0 ? (totalGP / totalRevenue) * 100 : 0;

    // Find the current month's YTD values (not full-year cumulative)
    const currentMonth = months.find((m: any) => m.monthKey === currentMonthKey);
    const lastDataMonth = currentMonth || months[months.length - 1];
    const finalYtdGP = lastDataMonth?.ytdGP ?? 0;
    const finalYtdBudget = lastDataMonth?.ytdBudget ?? 0;
    const finalYtdVariance = lastDataMonth?.ytdVariance ?? 0;
    const finalYtdGpPct = lastDataMonth?.ytdGpPct ?? 0;

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_revenue_lines,normalized_cost_lines",
      staleAfterSeconds: 60,
      nullCount: gpNullCount,
    });
    res.json({ months, projects, totalRevenue, totalCOS, totalGP, overallGpPct, ytdGP: finalYtdGP, ytdBudget: finalYtdBudget, ytdVariance: finalYtdVariance, ytdGpPct: finalYtdGpPct, nullCount: gpNullCount });
  } catch (error) {
    console.error("Portfolio GP tracker error:", error);
    res.status(500).json({ error: "Failed to fetch GP tracker data" });
  }
});

router.get("/api/gp-tracker/project/:projectName", requireAuth, requirePermission("gp_tracker", "view"), async (req, res) => {
  try {
    const projectName = decodeURIComponent(String(req.params.projectName || ""));
    const projectIdParam = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
    const [projectExpenses, revLines, cosOverrideMapProj] = await Promise.all([
      getHighRiskProjectCostReadRows(projectName, projectIdParam),
      storage.getProgramInflowsByProject(projectName),
      Promise.resolve(new Map()),
    ]);


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
    // UTC anchor — must match `cosCurrentMonthKey` in /api/cos-tracker so the
    // same line classifies the same way in aggregate and per-project views.
    const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const cosByMonth = new Map<string, number>();
    const realisedCosByMonth = new Map<string, number>();
    const revByMonth = new Map<string, number>();
    const realisedRevByMonth = new Map<string, number>();
    const itemsByMonth = new Map<string, any[]>();

    for (const exp of projectExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      if (!cosDate) continue;
      const dateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      cosByMonth.set(monthKey, (cosByMonth.get(monthKey) || 0) + amount);

      const cosRealised = isEffectivelyRealised(exp, monthKey, currentMonthKey);
      if (cosRealised) {
        realisedCosByMonth.set(monthKey, (realisedCosByMonth.get(monthKey) || 0) + amount);
      }

      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      // § 3.3 fix: use the canonical per-line revenue recognition amount
      // persisted on normalized_cost_lines.revenue_recognition_amount.
      // The previous formula `(amount / totalCOSAll) * totalMilestoneRevenue`
      // was project-pooled and under-counted YTD revenue by ~93%
      // (R 4.18M vs R 54.5M actual) for projects with incomplete NRL
      // milestone data.
      const revenueAmount = isNoRevLinked
        ? 0
        : (parseFloat((exp as any).revenueRecognitionAmount as string) || 0);

      revByMonth.set(monthKey, (revByMonth.get(monthKey) || 0) + revenueAmount);
      if (cosRealised) {
        realisedRevByMonth.set(monthKey, (realisedRevByMonth.get(monthKey) || 0) + revenueAmount);
      }

      if (!itemsByMonth.has(monthKey)) itemsByMonth.set(monthKey, []);
      itemsByMonth.get(monthKey)!.push({
        id: exp.id,
        canonicalLineKey: (exp as any).canonicalLineKey || null,
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
router.get("/api/gp-tracker/month-detail", requireAuth, requirePermission("gp_tracker", "view"), async (req, res) => {
  try {
    const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const keyMatch = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!keyMatch) return res.status(400).json({ error: "Invalid monthKey format" });

    const [allExpenses, allInflowsRaw, cosOverrideMapGPD] = await Promise.all([
      getHighRiskAllCostReadRows(),
      storage.getAllRevenueLinesForCashflow(),
      Promise.resolve(new Map()),
    ]);


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

      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      const itemMonthKey = extractMonthKey(cosDate);
      if (itemMonthKey !== monthKey) continue;

      const pName = normalizeProjectName(exp.projectName);
      if (project && pName !== project) continue;

      const isNoRevLinked = !!(exp as any).noRevenueLinked;
      // § 3.3 fix: use the canonical per-line revenue recognition amount
      // persisted on normalized_cost_lines.revenue_recognition_amount.
      // `allocateRevenue()` is deprecated — it uses project-pooled totals
      // instead of category-scoped per-line POC, producing ~93%
      // under-counted YTD revenue.
      const revenueAmount = isNoRevLinked
        ? 0
        : (parseFloat((exp as any).revenueRecognitionAmount as string) || 0);
      const gpAmount = revenueAmount - amount;

      const cosRealised = isEffectivelyRealised(exp, itemMonthKey, curMK);
      const gpState = cosRealised ? 'Realised' : 'Unrealised';

      if (stateFilter && stateFilter.toLowerCase() !== gpState.toLowerCase()) continue;

      items.push({
        id: exp.id,
        canonicalLineKey: (exp as any).canonicalLineKey || null,
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

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines,normalized_revenue_lines",
    });
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

/** Shared handler for the revenue tracker endpoint (used by both canonical and legacy routes). */
async function revenueTrackerHandler(req: Request, res: Response) {
  try {
    const [allExpenses, allInflowsRaw, manualEntries, cosOverrideMap] = await Promise.all([
      getHighRiskAllCostReadRows(),
      storage.getAllRevenueLinesForCashflow(),
      storage.getTrackerMonthlyManual('REV'),
      Promise.resolve(new Map()),
    ]);
    const [revenueLinks, qbInvoicesRaw, qbMonthlyPnL] = await Promise.all([
      qbLinksRepository.listActiveLinksByPair("revenue_line", "invoice"),
      getInvoices("2025-09-01", "2026-08-31").catch(() => ({ QueryResponse: { Invoice: [] } })),
      getMonthlyPnLReport("2025-09-01", "2026-08-31").catch(() => null),
    ]);


    const manualBudgetMap = new Map(manualEntries.map(e => [e.monthKey, e]));

    // Count revenue rows where amount is null but an invoice reference exists —
    // suspicious NULLs that silently coalesce to 0 in the total. Surfaces as an
    // amber "(N missing)" sublabel on the client KPI.
    let revenueNullCount = 0;

    const revenueByProject = new Map<string, number>();
    for (const inflow of allInflowsRaw) {
      const rawAmt = (inflow as any).milestoneAmount;
      const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
      const hasInvoice = !!((inflow as any).invoiceNumber && String((inflow as any).invoiceNumber).trim());
      if (!hasAmt && hasInvoice) revenueNullCount += 1;
      const amt = hasAmt ? parseFloat(String(rawAmt)) : 0;
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
    // UTC anchor — must match `cosCurrentMonthKey` in /api/cos-tracker so the
    // same line classifies the same way in aggregate and per-project views.
    const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const revByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    const realisedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();

    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      if (!cosDate) continue;
      const dateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      // Skip rows with no project association — keep revenue tracker project-scoped.
      if (!pName) continue;
      const isNoRevLinked = !!(exp as any).noRevenueLinked;

      // Per Revenue Recognition spec: amount = (this_line_actual / project_total_actual) × project_costed_revenue.
      // This formula is computed by the smart-import normalizer at write time and persisted on
      // normalized_cost_lines.revenue_recognition_amount (col U on the Expenditure Breakdown sheet).
      // Read the pre-computed canonical value directly. The previous on-the-fly recomputation used
      // sum(NRL.milestoneAmount) per project as the costed-revenue input, which under-counts every
      // project that has incomplete NRL milestone data — producing ~7% of the correct YTD revenue
      // figure (R 4.18M dashboard vs R 54.5M database vs R 57.6M management accounts).
      const revenueAmount = isNoRevLinked
        ? 0
        : (parseFloat((exp as any).revenueRecognitionAmount as string) || 0);

      if (!revByMonth.has(monthKey)) revByMonth.set(monthKey, { total: 0, projects: new Map() });
      const revBucket = revByMonth.get(monthKey)!;
      revBucket.total += revenueAmount;
      revBucket.projects.set(pName, (revBucket.projects.get(pName) || 0) + revenueAmount);

      const cosRealised = isEffectivelyRealised(exp, monthKey, currentMonthKey);
      if (cosRealised) {
        if (!realisedByMonth.has(monthKey)) realisedByMonth.set(monthKey, { total: 0, projects: new Map() });
        const realBucket = realisedByMonth.get(monthKey)!;
        realBucket.total += revenueAmount;
        realBucket.projects.set(pName, (realBucket.projects.get(pName) || 0) + revenueAmount);
      }
    }

    const qbInvoices = ((qbInvoicesRaw as any)?.QueryResponse?.Invoice ?? []).map(invoiceRawToSummary);
    void revenueLinks; // (kept fetched for invoice-link-based drilldowns elsewhere)
    const qbRevenueByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
    // QB Revenue actual = monthly credits to account 1000000 "Sales" from
    // the QB ProfitAndLoss report. This is finance's canonical revenue-
    // recognition source: ex-VAT, accrual-based, and includes both
    // invoice income and journal-entry recognition (e.g. milestone moves
    // from Deferred Revenue → Sales). Previously this row summed
    // Invoice.TotalAmt across all A/R invoices, which is VAT-inclusive
    // and double-counts deposits posted to liability accounts — producing
    // overstated figures (e.g. Sep 2025 reported R 11.76M vs QB Sales
    // ledger R 2.49M; Oct R 20.02M vs R 16.29M).
    const monthlySales = qbMonthlyPnL
      ? extractMonthlyAccountTotalsFromPnL(qbMonthlyPnL, (acc) => {
          if (acc.id === "1000000") return true;
          const name = (acc.name || "").trim().toLowerCase();
          return name === "sales";
        })
      : new Map<string, number>();
    if (qbMonthlyPnL && monthlySales.size === 0) {
      // Diagnostic: parser found no Sales row. Dump the income-section
      // account names + ids visible in the report so we can see what the
      // realm actually returns. Logs once per request.
      try {
        const seen: Array<{ id: string | null; name: string | null; type: string }> = [];
        const walk = (row: any) => {
          if (!row) return;
          const hCell = row?.Header?.ColData?.[0];
          const dCell = Array.isArray(row?.ColData) ? row.ColData[0] : null;
          if (hCell)
            seen.push({ id: hCell.id ?? null, name: hCell.value ?? null, type: "Section" });
          if (dCell)
            seen.push({ id: dCell.id ?? null, name: dCell.value ?? null, type: row.type ?? "?" });
          for (const c of row?.Rows?.Row ?? []) walk(c);
        };
        for (const r of qbMonthlyPnL?.Rows?.Row ?? []) walk(r);
        console.warn("[qb-revenue] No 1000000/Sales row matched. Accounts visible in P&L:", JSON.stringify(seen.slice(0, 60)));
      } catch (e) {
        console.warn("[qb-revenue] diagnostic dump failed:", (e as Error)?.message);
      }
    }
    monthlySales.forEach((amount, monthKey) => {
      if (!Number.isFinite(amount) || amount === 0) return;
      if (!qbRevenueByMonth.has(monthKey)) qbRevenueByMonth.set(monthKey, { total: 0, projects: new Map() });
      const bucket = qbRevenueByMonth.get(monthKey)!;
      bucket.total += amount;
      bucket.projects.set("Sales (a/c 1000000)", (bucket.projects.get("Sales (a/c 1000000)") || 0) + amount);
    });

    const months: any[] = [];
    const startMonth = new Date(Date.UTC(2025, 8, 1));
    let ytdRevenue = 0, ytdRealised = 0, ytdBudget = 0, ytdQbRevenueActual = 0;

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
      const qbRevenueBucket = qbRevenueByMonth.get(monthKey);
      const qbRevenueActual = qbRevenueBucket?.total ?? 0;

      const manual = manualBudgetMap.get(monthKey);
      const budget = manual?.budget ? parseFloat(manual.budget) : 0;
      const variance = totalRevenue - budget;
      const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

      // QB vs App recon on revenue — QB total minus realised recognised in app.
      const qbVsAppVariance = qbRevenueActual - realisedRevenue;
      const qbVsAppVariancePct = qbRevenueActual !== 0 ? (qbVsAppVariance / qbRevenueActual) * 100 : 0;

      ytdRevenue += totalRevenue;
      ytdRealised += realisedRevenue;
      ytdQbRevenueActual += qbRevenueActual;
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
        qbRevenueActual,
        qbVsAppVariance,
        qbVsAppVariancePct,
        budget,
        variance,
        variancePct,
        ytdRevenue,
        ytdRealised,
        ytdUnrealised,
        ytdQbRevenueActual,
        ytdBudget,
        ytdVariance,
        ytdVariancePct,
        revProjects: mapToSortedArray(bucket?.projects ?? new Map()),
        realisedProjects: mapToSortedArray(realisedBucket?.projects ?? new Map()),
        qbRevenueProjects: mapToSortedArray(qbRevenueBucket?.projects ?? new Map()),
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

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_revenue_lines",
      staleAfterSeconds: 60,
      nullCount: revenueNullCount,
    });
    res.json({
      months,
      totalMilestoneRevenue,
      totalCOS,
      nullCount: revenueNullCount,
    });
  } catch (error) {
    console.error("Revenue tracker error:", error);
    res.status(500).json({ error: "Failed to fetch revenue tracker data" });
  }
}

// Canonical route: /api/revenue-tracker — called by the frontend (revenue-tracker.tsx)
router.get("/api/revenue-tracker", requireAuth, requirePermission("revenue_tracker", "view"), revenueTrackerHandler);

router.get("/api/revenue-tracker/month-detail", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  try {
    const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
    if (!monthKey) return res.status(400).json({ error: "monthKey required" });

    const matchRev = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!matchRev) return res.status(400).json({ error: "Invalid monthKey format" });

    const lastDayRev = new Date(Number(matchRev[1]), Number(matchRev[2]), 0).getDate();
    const monthEndRev = `${monthKey}-${String(lastDayRev).padStart(2, '0')}`;

    const [allExpenses, cosOverrideMapRMD] = await Promise.all([
      project ? getCanonicalProjectCostLinesByName(project).then((r) => r.rows) : getCanonicalAllCurrentCostLines(),
      Promise.resolve(new Map()),
    ]);
    const [revenueLinks, qbInvoicesRaw] = await Promise.all([
      qbLinksRepository.listActiveLinksByPair("revenue_line", "invoice"),
      getInvoices(`${monthKey}-01`, monthEndRev).catch(() => ({ QueryResponse: { Invoice: [] } })),
    ]);


    const allInflowsRaw = project
      ? await storage.getProgramInflowsByProject(project)
      : await storage.getAllRevenueLinesForCashflow();

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
    // UTC anchor — must match `cosCurrentMonthKey` in /api/cos-tracker so the
    // same line classifies the same way in aggregate and per-project views.
    const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const items: any[] = [];
    for (const exp of allExpenses) {
      if (exp.rowType !== 'item') continue;
      const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
      if (isNaN(amount) || amount === 0) continue;

      const { date: cosDate } = getCosEffectiveDateAndSource(exp);
      if (!cosDate) continue;
      const dateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
      if (!dateMatch) continue;
      const itemMonthKey = `${dateMatch[1]}-${dateMatch[2]}`;
      if (itemMonthKey !== monthKey) continue;

      const pName = (exp.projectName || '').replace(/_Tracker$/i, '');
      // Keep revenue drill-down project-scoped — skip lines with no project.
      if (!pName) continue;
      const isNoRevLinked = !!(exp as any).noRevenueLinked;

      // Per Revenue Recognition spec: amount = (this_line_actual / project_total_actual) × project_costed_revenue.
      // This formula is computed by the smart-import normalizer at write time and persisted on
      // normalized_cost_lines.revenue_recognition_amount (col U on the Expenditure Breakdown sheet).
      // Read the pre-computed canonical value directly. The previous on-the-fly recomputation used
      // sum(NRL.milestoneAmount) per project as the costed-revenue input, which under-counts every
      // project that has incomplete NRL milestone data — producing ~7% of the correct YTD revenue
      // figure (R 4.18M dashboard vs R 54.5M database vs R 57.6M management accounts).
      const revenueAmount = isNoRevLinked
        ? 0
        : (parseFloat((exp as any).revenueRecognitionAmount as string) || 0);

      const cosRealised = isEffectivelyRealised(exp, itemMonthKey, currentMonthKey);
      const revState = cosRealised ? 'Realised' : 'Unrealised';

      if (stateFilter && stateFilter.toLowerCase() !== revState.toLowerCase()) continue;

      items.push({
        id: exp.id,
        canonicalLineKey: (exp as any).canonicalLineKey || null,
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
        dataSource: "app",
        qbTransactionType: null,
        qbDocNumber: null,
        paymentReference: null,
        transactionDate: null,
        recognitionDate: exp.expenseInvoicedDate || null,
        sourceTraceId: `ncl:${exp.id}`,
        matchStatus: "app_only",
      });
    }

    const qbInvoices = ((qbInvoicesRaw as any)?.QueryResponse?.Invoice ?? []).map(invoiceRawToSummary);
    const linkedIds = new Set(revenueLinks.map((l: any) => String(l.qbEntityId)));
    for (const inv of qbInvoices) {
      if (!linkedIds.has(String(inv.id))) continue;
      const invMonth = String(inv.txnDate || "").slice(0, 7);
      if (invMonth !== monthKey) continue;
      if (stateFilter && stateFilter.toLowerCase() !== "qb_actual") continue;
      // Task #18 — txnDate fallback flag. QB Invoice rarely carries an
      // explicit settlement date in the snapshot; we fall back to TxnDate
      // (issue date) and surface that to the UI via dateSource so finance
      // can see it's an issue-date proxy, not a confirmed payment date.
      const balance = Number((inv as any).balance ?? 0);
      const dateSource = balance === 0 ? "qb_txn_date_paid" : "qb_txn_date_fallback";
      const dateSourceLabel = balance === 0
        ? "QB Issue date (invoice fully paid)"
        : "QB Issue date — no settlement/payment date in QB; using TxnDate as proxy";
      items.push({
        id: Number(`9${String(inv.id).replace(/\D/g, "").slice(0, 8)}`) || 0,
        canonicalLineKey: null,
        projectName: project || "Mapped QB Revenue",
        category: null,
        lineItem: null,
        costAmount: 0,
        revenueAmount: Number(inv.totalAmount ?? 0),
        invoiceNumber: inv.docNumber || null,
        poNumber: null,
        invoiceDate: inv.txnDate || null,
        supplier: inv.customerName || null,
        isRealised: true,
        noRevenueLinked: false,
        revState: "QB Actual",
        dataSource: "quickbooks",
        dateSource,
        dateSourceLabel,
        qbTransactionType: "Invoice",
        qbDocNumber: inv.docNumber || null,
        paymentReference: null,
        transactionDate: inv.txnDate || null,
        recognitionDate: inv.txnDate || null,
        sourceTraceId: `qb-invoice:${inv.id}`,
        matchStatus: "matched",
      });
    }

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines,normalized_revenue_lines,quickbooks_invoice_links",
    });
    res.json(items);
  } catch (error) {
    console.error("Revenue tracker month-detail error:", error);
    res.status(500).json({ error: "Failed to fetch revenue tracker month detail" });
  }
});

router.get("/api/revenue-tracker/reconciliation", requireAuth, requirePermission("revenue_tracker", "view"), async (req, res) => {
  try {
    const { monthKey } = req.query as { monthKey?: string };
    const [revenueRows, links, qbInvoicesRaw] = await Promise.all([
      financeInflowsRepository.listAllActiveRevenueLines(),
      qbLinksRepository.listActiveLinksByPair("revenue_line", "invoice"),
      getInvoices("2025-09-01", "2026-08-31").catch(() => ({ QueryResponse: { Invoice: [] } })),
    ]);

    const invoices = ((qbInvoicesRaw as any)?.QueryResponse?.Invoice ?? []).map(invoiceRawToSummary);
    const invoiceById = new Map<string, any>(invoices.map((inv: any) => [String(inv.id), inv]));
    // Task #142 multimap.
    const linkByRevenue = new Map<number, any[]>();
    for (const l of links as any[]) {
      const arr = linkByRevenue.get(l.appEntityId) ?? [];
      arr.push(l);
      linkByRevenue.set(l.appEntityId, arr);
    }
    const linkedInvoiceIds = new Set<string>(links.map((l: any) => String(l.qbEntityId)));
    const recRows: Array<any> = [];

    const revenueReasonsFor = (row: any, inv: any) => {
      const reasons: string[] = [];
      if (!row?.paidDate && !row?.inBankDate) reasons.push("Missing payment receipt date");
      if (!row?.invoiceNumber) reasons.push("Missing invoice number");
      if (!row?.projectName) reasons.push("Project mapping missing");
      if (!inv?.customerName) reasons.push("Customer mapping missing");
      const appAmt = Number(row?.amountExVat || 0);
      const qbAmt = Number(inv?.totalAmount || 0);
      if (appAmt && qbAmt && Math.abs(appAmt - qbAmt) > 1) reasons.push("Amount mismatch");
      // REV realisation is bucketed by invoice_date only (per finance rule).
      const appMonth = String(row?.invoiceDate || "").slice(0, 7);
      const qbMonth = String(inv?.txnDate || "").slice(0, 7);
      if (appMonth && qbMonth && appMonth !== qbMonth) reasons.push("Posted to wrong month");
      return reasons;
    };

    for (const row of revenueRows as any[]) {
      const siblings = linkByRevenue.get(row.id) ?? [];
      const link = siblings[0];
      const inv = link ? invoiceById.get(String(link.qbEntityId)) : null;
      // REV bucketing — invoice_date first; fall back to QB invoice txn date if
      // the app row has no invoice_date yet.
      const month = String(row.invoiceDate || inv?.txnDate || "").slice(0, 7);
      if (!month) continue;
      if (monthKey && month !== monthKey) continue;
      const reasons = link ? revenueReasonsFor(row, inv) : revenueReasonsFor(row, null);
      const tab = link ? (reasons.length ? "exceptions" : "matched") : "app_only";
      // Task #142 — sum the allocations attributed to THIS app revenue line
      // across its sibling links so we don't credit a multi-line invoice's
      // total to every linked app row.
      const allocatedQbAmount = siblings.reduce(
        (acc: number, l: any) =>
          acc +
          (effectiveAllocatedAmountExVat({
            allocatedAmountExVat: l.allocatedAmountExVat ?? null,
            qbAmount: l.qbAmount ?? null,
          }) ?? 0),
        0,
      );
      recRows.push({
        month,
        project: (row.projectName || "").replace(/_Tracker$/i, "") || "Unknown Project",
        appAmount: Number(row.amountExVat || 0),
        qbAmount: link ? Number(allocatedQbAmount) : 0,
        appId: row.id,
        qbId: inv?.id ?? null,
        matchStatus: link ? "matched" : "app_only",
        tab,
        reasonCodes: link ? reasons : [...new Set(["Excluded by business rule", ...reasons])],
        invoiceNumber: row.invoiceNumber || null,
      });
    }

    for (const inv of invoices as any[]) {
      if (linkedInvoiceIds.has(String(inv.id))) continue;
      const month = String(inv.txnDate || "").slice(0, 7);
      if (!month) continue;
      if (monthKey && month !== monthKey) continue;
      recRows.push({
        month,
        project: "Unmapped QB Invoice",
        appAmount: 0,
        qbAmount: Number(inv.totalAmount || 0),
        appId: null,
        qbId: inv.id,
        matchStatus: "qb_only",
        tab: "qb_only",
        reasonCodes: ["Customer mapping missing", "Project mapping missing", "Sync error"],
        invoiceNumber: inv.docNumber || null,
      });
    }

    const summaryMap = new Map<string, any>();
    for (const row of recRows) {
      const key = `${row.month}::${row.project}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          month: row.month,
          project: row.project,
          appRevenue: 0,
          qbRevenue: 0,
          appOnlyItemCount: 0,
          qbOnlyItemCount: 0,
          missingPaymentReceiptDateCount: 0,
          missingInvoiceCount: 0,
          mappingIssueCount: 0,
        });
      }
      const s = summaryMap.get(key)!;
      s.appRevenue += row.appAmount;
      s.qbRevenue += row.qbAmount;
      if (row.matchStatus === "app_only") s.appOnlyItemCount++;
      if (row.matchStatus === "qb_only") s.qbOnlyItemCount++;
      if (row.reasonCodes.includes("Missing payment receipt date")) s.missingPaymentReceiptDateCount++;
      if (row.reasonCodes.includes("Missing invoice number")) s.missingInvoiceCount++;
      if (row.reasonCodes.includes("Project mapping missing") || row.reasonCodes.includes("Customer mapping missing")) s.mappingIssueCount++;
    }

    const summary = Array.from(summaryMap.values()).map((s: any) => {
      const delta = s.appRevenue - s.qbRevenue;
      const deltaPct = s.qbRevenue !== 0 ? (delta / s.qbRevenue) * 100 : 0;
      const status = Math.abs(deltaPct) <= 2 ? "Matched" : Math.abs(deltaPct) <= 10 ? "Investigate" : "Exception";
      return { ...s, delta, deltaPct, status };
    });

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_revenue_lines",
      derivedTable: "quickbooks_invoice_links",
    });
    res.json({
      summary,
      tabs: {
        matched: recRows.filter((r) => r.tab === "matched"),
        appOnly: recRows.filter((r) => r.tab === "app_only"),
        qbOnly: recRows.filter((r) => r.tab === "qb_only"),
        exceptions: recRows.filter((r) => r.tab === "exceptions"),
      },
      recognitionRule: {
        preferredField: "paidDate|inBankDate",
        qbFallbackField: "txnDate",
        note: "QuickBooks invoice payload does not include settlement date in current integration query; txnDate fallback is used.",
      },
    });
  } catch (error) {
    console.error("Revenue reconciliation error:", error);
    res.status(500).json({ error: "Failed to fetch revenue reconciliation" });
  }
});

// ==================== PROGRAM EXPENSES & INFLOWS ====================

router.get("/api/program-expenses", requireAuth, async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let expenses;

    if (projectName && typeof projectName === 'string') {
      const resolvedProjectId = await resolveProjectIdByName(projectName);
      expenses = resolvedProjectId ? await getCanonicalProjectCostLines(resolvedProjectId) : [];
    } else {
      expenses = await getCanonicalAllCurrentCostLines();
    }
    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines",
    });

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

// DEPRECATED — prefer /api/projects/:projectName/cost-lines.
// Scheduled for removal in the next release after consumers migrate.
router.get("/api/program-expenses/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const expenses = await getCanonicalProjectCostLinesByName(projectName).then((r) => r.rows);
    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines",
    });

    res.set("Deprecation", "true");
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch program expenses", message: "Failed to fetch program expenses" });
  }
});

router.get("/api/finance/cost-lines/diagnostics", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectIdParam = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
    const scopedProjectId = Number.isFinite(projectIdParam) ? projectIdParam! : undefined;
    const [canonicalDiagnostics, riskDiagnostics] = await Promise.all([
      getCanonicalCostLineDiagnostics(scopedProjectId),
      getCostLineRiskDiagnostics(scopedProjectId),
    ]);
    res.json({
      canonical: canonicalDiagnostics,
      risks: riskDiagnostics,
    });
  } catch (error) {
    console.error("Cost-line diagnostics error:", error);
    res.status(500).json({ error: "Failed to fetch cost-line diagnostics" });
  }
});

router.get("/api/finance/trust-core-report", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const report = await buildFinanceCoreTrustReport();
    setFinanceTrustHeaders(res, {
      sourceLayer: "derived",
      canonicalTable: "normalized_cost_lines,normalized_revenue_lines",
      derivedTable: "finance_cos_monthly,finance_revenue_monthly",
      staleAfterSeconds: 900,
      refreshedAt: (report as any)?.generatedAt,
    });
    res.json(report);
  } catch (error) {
    console.error("Finance trust-core report error:", error);
    res.status(500).json({ error: "Failed to build finance trust-core report" });
  }
});


// DEPRECATED — prefer /api/projects/:projectName/revenue-lines.
// Scheduled for removal in the next release after consumers migrate.
router.get("/api/program-inflows", requireAuth, async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let inflows;

    if (projectName && typeof projectName === 'string') {
      inflows = await storage.getProgramInflowsByProject(projectName);
      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "normalized_revenue_lines",
      });
    } else {
      inflows = await storage.getAllProgramInflows();
      setFinanceTrustHeaders(res, {
        sourceLayer: "canonical",
        canonicalTable: "normalized_revenue_lines",
      });
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

    res.set("Deprecation", "true");
    res.json(inflows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch program inflows", message: "Failed to fetch program inflows" });
  }
});

// ==================== CANONICAL PROJECT FINANCE LINES ====================

router.get("/api/projects/:projectName/cost-lines", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const expenses = await getCanonicalProjectCostLinesByName(projectName).then((r) => r.rows);
    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_cost_lines",
    });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch cost lines", message: "Failed to fetch cost lines" });
  }
});

router.get("/api/projects/:projectName/revenue-lines", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const { startDate, endDate } = req.query;
    let inflows = await storage.getProgramInflowsByProject(projectName);
    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "normalized_revenue_lines",
    });

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
    res.status(500).json({ error: "Failed to fetch revenue lines", message: "Failed to fetch revenue lines" });
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

    // Override data now baked into base rows

    const expenses = projectName
      ? await getCanonicalProjectCostLinesByName(projectName).then((r) => r.rows)
      : await getCanonicalAllCurrentCostLines();

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
          const d = exp.adminDateOverride || exp.expensePaymentDate || exp.computedForecastPaymentDate || exp.forecastPaymentDate || exp.expenseInvoicedDate || null;
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

    setFinanceTrustHeaders(res, {
      sourceLayer: "canonical",
      canonicalTable: "cashflow_points,normalized_cost_lines,normalized_revenue_lines",
      staleAfterSeconds: 60,
    });
    res.json(points);
  } catch (error) {
    console.error("Cashflow API error:", error);
    res.status(500).json({ error: "Failed to fetch cashflow data" });
  }
});

router.get("/api/cashflow/planning-overrides", requireAuth, async (req, res) => {
  try {
    const { projectName } = req.query;
    let overrides: any[];

    // Override data now baked into base rows
    overrides = [];

    res.json(overrides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch planning overrides", message: "Failed to fetch planning overrides" });
  }
});

router.post("/api/cashflow/planning-overrides", requireAuth, requireAdmin, validateBody(planningOverridesSchema), async (req, res) => {
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

    const saved = await (storage as any).upsertManyPlanningOverrides(overridesWithUser);

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
      error: "Failed to save planning overrides"
    });
  }
});

router.delete("/api/cashflow/planning-overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await storage.deleteProjectPlanOverridesByProject(projectName);
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
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch revenue tracking overrides", message: "Failed to fetch revenue tracking overrides" });
  }
});

router.post("/api/revenue-tracking/overrides", requireAuth, requireAdminOrFinancialEditor, requirePermission('financials', 'edit'), validateBody(revenueTrackingOverridesSchema), async (req, res) => {
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

    const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))];
    const baselineRowsByProject = new Map<string, Map<number, any>>();
    const saved: any[] = [];

    for (const projectName of projectNames) {
      const rawInflows = await storage.getProgramInflowsByProject(projectName);
      baselineRowsByProject.set(
        projectName,
        new Map(rawInflows.map((row: any) => [row.rowNumber, row])),
      );
    }

    // Apply overrides directly to the base table (normalized_revenue_lines).
    // Workstream B: tracked fields go to manual_overrides JSONB; untracked
    // fields (presentation metadata like font colours) keep writing to the
    // live column. Gated by USE_MANUAL_OVERRIDES.
    const revenueLegacyToCanonical: Record<string, string> = {
      milestoneInvoiceNumber: "invoiceNumber",
      invoiceRaisedDate: "invoiceDate",
      paymentReceivedDate: "paidDate",
      plannedPaymentDate: "expectedPaymentDate",
      milestoneAmount: "amountExVat",
      milestoneNotes: "milestoneNotes",
      invoiceDateConfirmed: "invoiceDateConfirmed",
      paidDateConfirmed: "paidDateConfirmed",
    };
    const revenueTrackedSet = new Set<string>(REVENUE_TRACKED_FIELDS as readonly string[]);
    const useOverridesRev = manualOverridesEnabled();

    for (const pn of projectNames) {
      const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
      const inflows = baselineRowsByProject.get(pn)!;

      const rowGroups = new Map<number, Record<string, any>>();
      for (const ov of projectOverrides) {
        const inflow = inflows.get(ov.rowNumber);
        if (!inflow) continue;
        // The id from the inflow may be a negative legacy adapter id;
        // resolve to the canonical normalized_revenue_lines id.
        const rawId = inflow.id as number;
        const canonicalId = rawId < 0 ? -rawId : (rawId >= 900000 ? rawId - 900000 : rawId);
        if (!rowGroups.has(canonicalId)) rowGroups.set(canonicalId, {});
        const fields = rowGroups.get(canonicalId)!;
        const effectiveValue = ov.overrideValue === "__null__" ? null : ov.overrideValue;
        fields[ov.fieldName] = effectiveValue;
      }

      for (const [revRowId, fields] of rowGroups.entries()) {
        if (Object.keys(fields).length === 0) continue;
        if (!useOverridesRev) {
          const result = await storage.updateProgramInflowFields(revRowId, fields);
          if (result) saved.push(result);
          continue;
        }
        const trackedEntries: [string, any][] = [];
        const untrackedFields: Record<string, any> = {};
        for (const [legacyKey, value] of Object.entries(fields)) {
          const canonicalKey = revenueLegacyToCanonical[legacyKey] ?? legacyKey;
          if (revenueTrackedSet.has(canonicalKey)) {
            trackedEntries.push([canonicalKey, value]);
          } else {
            untrackedFields[legacyKey] = value;
          }
        }
        for (const [canonicalKey, value] of trackedEntries) {
          await applyManualOverride({
            table: "normalized_revenue_lines",
            rowId: revRowId,
            fieldName: canonicalKey,
            value: value as any,
            editedBy: userId ?? null,
            note: overrideComment.trim(),
          });
        }
        if (Object.keys(untrackedFields).length > 0) {
          const result = await storage.updateProgramInflowFields(revRowId, untrackedFields);
          if (result) saved.push(result);
        } else {
          // Track save count even when only override fields changed.
          saved.push({ id: revRowId, _viaManualOverrides: true });
        }
      }
    }

    // Sync inBank status on updated rows.
    // Workstream B: paidDateConfirmed / paidDate / inBankDate are tracked
    // fields, so when USE_MANUAL_OVERRIDES is on the sync writes through
    // applyManualOverride; paidDateFontColor is presentation metadata
    // (untracked) and keeps writing to the live column directly.
    try {
      for (const projectName of projectNames) {
        const appliedRows = await storage.getProgramInflowsByProject(projectName);
        for (const r of appliedRows) {
          const milestoneNo = r.milestoneNo;
          if (!milestoneNo || !/^\d+$/.test(String(milestoneNo).trim())) continue;
          const rowNum = r.rowNumber;
          if (!rowNum) continue;
          const manualInBank = r.inBank === 1 || r.inBank === '1' || r.inBank === true;
          const hasInvoice = !!(r.milestoneInvoiceNumber && String(r.milestoneInvoiceNumber).trim());
          const hasPaymentReceived = !!(r.paymentReceivedDate && String(r.paymentReceivedDate).trim() && r.paymentReceivedDate !== '-');
          const confirmedByColor = typeof (r as any).paymentReceivedDateFontColor === "string"
            ? (r as any).paymentReceivedDateFontColor.toLowerCase() === "black"
            : false;
          const confirmedByFlag = (r as any).paymentReceivedDateConfirmed === true;
          const paymentConfirmed = confirmedByFlag || confirmedByColor;
          const isInBank = manualInBank || (hasPaymentReceived && hasInvoice && paymentConfirmed);
          const paidDateConfirmed = isInBank;
          const paidDateFontColor = isInBank ? 'black' : 'red';
          const paidDate = isInBank ? (r.paymentReceivedDate || r.plannedPaymentDate || null) : null;
          // Resolve canonical row id from the legacy adapter shape.
          const rawId = r.id as number;
          const canonicalRevId = rawId < 0 ? -rawId : (rawId >= 900000 ? rawId - 900000 : rawId);
          if (!useOverridesRev) {
            await financeInflowsRepository.updateInBankByProjectAndRow({
              projectName,
              sourceRow: rowNum,
              paidDateConfirmed,
              paidDateFontColor,
              paidDate,
              inBankDate: isInBank ? (paidDate || null) : null,
            });
            continue;
          }
          // Tracked fields → manual_overrides
          await applyManualOverride({
            table: "normalized_revenue_lines",
            rowId: canonicalRevId,
            fieldName: "paidDateConfirmed",
            value: paidDateConfirmed,
            editedBy: userId ?? null,
            note: "inBank sync after revenue override",
          });
          await applyManualOverride({
            table: "normalized_revenue_lines",
            rowId: canonicalRevId,
            fieldName: "paidDate",
            value: paidDate,
            editedBy: userId ?? null,
            note: "inBank sync after revenue override",
          });
          await applyManualOverride({
            table: "normalized_revenue_lines",
            rowId: canonicalRevId,
            fieldName: "inBankDate",
            value: isInBank ? (paidDate || null) : null,
            editedBy: userId ?? null,
            note: "inBank sync after revenue override",
          });
          // Untracked: font colour to live column.
          await financeInflowsRepository.updatePaidDateFontColorById(canonicalRevId, paidDateFontColor);
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
    res.status(500).json({ error: "Failed to save revenue tracking overrides" });
  }
});

router.delete("/api/revenue-tracking/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    // Override tables collapsed into base tables — no separate overrides to delete
    res.json({ message: `Revenue tracking overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete revenue tracking overrides", message: "Failed to delete revenue tracking overrides" });
  }
});

// ==================== REVENUE TAB ====================

router.get("/api/revenue-tab/:projectName", requireAuth, async (req, res) => {
  try {
    const projectName = paramStr(req.params.projectName);

    let useCanonical = false;
    try { useCanonical = await isWorkItemsEnabled(); } catch (_e) { /* feature flag unavailable */ }

    const [rawInflows, overrides, projectInfoList, savedSummary, canonicalTasks, legacyOperationalTasks, planTasks, taskLinks] = await Promise.all([
      // Operational-tab read: overlay manual_overrides on top of the
      // live column for tracked revenue fields.
      storage.getProgramInflowsByProject(projectName, { applyOverrides: manualOverridesEnabled() }),
      Promise.resolve([]),
      storage.getAllProjectInfo(),
      storage.getProjectRevenueSummary(projectName).catch(() => undefined),
      useCanonical ? getWorkItemsAsOperationalTasks(projectName).catch(() => []) : Promise.resolve([]),
      storage.getOperationalTasksByProject(projectName).catch(() => []),
      storage.getProjectPlansByProject(projectName).catch(() => []),
      storage.getMilestoneTaskLinks(projectName).catch(() => []),
    ]);
    const operationalTasks = (useCanonical && canonicalTasks.length > 0) ? canonicalTasks : legacyOperationalTasks;

    const inflows = rawInflows;
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

    const emptyGovernance = {
      latestChangeByEntity: new Map<string, any>(),
      userNameById: new Map<number, string>(),
      recentChanges: [] as any[],
      approvals: { pendingCount: 0, affectingCashCount: 0, pending: [] as any[] },
      editRequests: { pendingCount: 0, pending: [] as any[] },
      microsoft: { linkedCount: 0, actionRequiredCount: 0, unreadCount: 0, linkedTaskCount: 0, recent: [] as any[] },
    };
    let governance = emptyGovernance;
    try {
      governance = await loadProjectFinanceGovernanceContext(
        projectName,
        (pInfo as any)?.id ?? null,
        overrides
          .map((row: any) => row.createdBy)
          .filter((id: any): id is number => typeof id === "number" && Number.isFinite(id))
      );
    } catch (govError) {
      console.error("Revenue tab: governance context failed, continuing with empty governance:", govError);
    }

    const milestones = inflows.filter(isRealMilestone).map((r: any) => {
      const hasInvoice = !!(r.milestoneInvoiceNumber && r.milestoneInvoiceNumber.trim());
      const manualInBank = r.inBank === 1 || r.inBank === '1' || r.inBank === true;
      const hasPaymentReceived = !!(r.paymentReceivedDate && r.paymentReceivedDate.trim() && r.paymentReceivedDate !== '-');
      const confirmedByColor = typeof r.paymentReceivedDateFontColor === "string"
        ? r.paymentReceivedDateFontColor.toLowerCase() === "black"
        : false;
      const confirmedByFlag = r.paymentReceivedDateConfirmed === true;
      const paymentConfirmed = confirmedByFlag || confirmedByColor;
      const inBank = manualInBank || (hasPaymentReceived && hasInvoice && paymentConfirmed);

      const date = r.paymentReceivedDate || r.plannedPaymentDate || null;
      const isConfirmed = inBank && hasInvoice;
      const isRed = !isConfirmed;
      const isPast = date ? date < today : false;

      let status: string;
      let flags: string[] = [];

      if (inBank && hasInvoice) {
        status = 'inBank';
      } else if (hasInvoice) {
        status = 'invoiced';
        if (hasPaymentReceived && !paymentConfirmed) {
          flags.push('Payment date present but not confirmed — treated as outstanding');
        } else {
          flags.push('Invoice raised, payment outstanding');
        }
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
        // Smart Import v2 cell formatting (font/fill colour) for the
        // milestone row. Surfaced so the existing Revenue tab can render
        // the same per-cell colours as the new revenue-tracking replica.
        cellFormat: r.cellFormat ?? null,
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
    const invoiced = milestones.filter((m: any) => m.status === 'invoiced' || m.status === 'inBank' || m.status === 'received').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const inBankTotal = milestones.filter((m: any) => m.status === 'inBank').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const pending = milestones.filter((m: any) => m.status === 'planned' || m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
    const overdueTotal = milestones.filter((m: any) => m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);

    let costedExpenditure = 0;
    let actualExpenditure = 0;
    let allExpenditure = 0;
    try {
      const { rows: expenseRows } = await getCanonicalProjectCostLinesByName(projectName);
      for (const row of expenseRows) {
        if ((row as any).rowType === 'item') {
          costedExpenditure += parseFloat(String((row as any).budgetTotal || 0)) || 0;
          const lineAmt = parseFloat(String((row as any).quotedTotal || (row as any).expenseActualTotal || 0)) || 0;
          const confirmedAmt = parseFloat(String((row as any).expenseActualTotal || 0)) || 0;
          allExpenditure += confirmedAmt;
          const state = (row as any).computedState || classifyExpenseState(row as any);
          if (state === 'Paid' && lineAmt > 0) {
            actualExpenditure += lineAmt;
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
    const projectName = paramStr(req.params.projectName);
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
    const projectName = paramStr(req.params.projectName);
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
    const projectName = paramStr(req.params.projectName);
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

    // Refresh dashboard metrics for this project
    try {
      const allProjectInfoRows = await storage.getAllProjectInfo();
      const proj = allProjectInfoRows.find((p: any) => p.projectName === projectName);
      if (proj) refreshProjectMetricsAsync(proj.id);
    } catch (metricsErr: any) {
      console.warn("[finance] Revenue date override metrics refresh failed:", metricsErr.message);
    }
  } catch (error) {
    console.error("Date override error:", error);
    res.status(500).json({ error: "Failed to save date override" });
  }
});

router.delete("/api/revenue-tab/:projectName/link-task/:milestoneRowNumber", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = paramStr(req.params.projectName);
    const milestoneRowNumber = parseIntParam(req.params.milestoneRowNumber);
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
    res.json([]);
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

    const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];

    // PM-only roles require approval; admins and financial approvers apply directly
    if (isPmOnlyRole(userRole)) {
      const hasHighExpense = overrides.some((o: any) => o.fieldName === "expenseActualTotal" && Number(o.overrideValue) > 50000);
      const hasBudgetChange = overrides.some((o: any) => o.fieldName === "budgetTotal");
      const editSummary = `Expenditure override: ${overrides.length} field(s). Category: ${overrideCategory}. Comment: ${overrideComment.trim()}${hasHighExpense ? " [HIGH EXPENSE]" : ""}${hasBudgetChange ? " [BUDGET CHANGE]" : ""} [Submitted by ${userRole || "unknown"}]`;
      const saved = await createPendingEditRequest(
        userId!,
        projectNames[0] || "Unknown",
        "expenditure_override",
        "expenditure_tracking",
        { overrides, overrideCategory, overrideComment },
        editSummary
      );
      return res.json({
        message: "Your cost correction has been submitted for approval",
        status: "pending_approval",
        requestId: saved.id,
      });
    }

    // Admin/approver: apply overrides directly to base table
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

    // Workstream B (live=Excel invariant): map legacy client field names
    // to canonical normalized_cost_lines column names so we can route
    // tracked fields into manual_overrides instead of the live column.
    // Fields not in this map (or not in EXPENDITURE_TRACKED_FIELDS)
    // continue writing to the live column via the legacy
    // updateProgramExpenseFields path.
    const legacyToCanonical: Record<string, string> = {
      expenseLineItem: "description",
      expenseActualTotal: "amountExVat",
      expenseInvoiceNumber: "invoiceNumber",
      expenseInvoicedDate: "invoiceDate",
      expensePaymentDate: "paidDate",
      expensePoNumber: "poNumber",
      forecastPaymentDate: "forecastPaymentDate",
      supplierName: "counterpartyName",
      budgetTotal: "budgetTotal",
      budgetQty: "budgetQty",
      budgetRateUnit: "budgetRate",
      // boolean confirmation flags
      invoiceDateConfirmed: "invoiceDateConfirmed",
      paymentDateConfirmed: "paidDateConfirmed",
    };
    const trackedSet = new Set<string>(EXPENDITURE_TRACKED_FIELDS as readonly string[]);
    const useOverrides = manualOverridesEnabled();

    for (const pn of projectNames) {
      const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
      // Use the raw (no-overlay) canonical reader here so the lookup
      // sees actual row IDs, not overlaid display values.
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
        if (Object.keys(fields).length === 0) continue;
        if (!useOverrides) {
          // Feature flag off: legacy behaviour — write everything to the
          // live column.
          await storage.updateProgramExpenseFields(expenseId, fields);
          continue;
        }
        // Split tracked fields → manual_overrides; untracked fields →
        // legacy live-column write.
        const trackedEntries: [string, any][] = [];
        const untrackedFields: Record<string, any> = {};
        for (const [legacyKey, value] of Object.entries(fields)) {
          const canonicalKey = legacyToCanonical[legacyKey] ?? legacyKey;
          if (trackedSet.has(canonicalKey)) {
            trackedEntries.push([canonicalKey, value]);
          } else {
            untrackedFields[legacyKey] = value;
          }
        }
        for (const [canonicalKey, value] of trackedEntries) {
          await applyManualOverride({
            table: "normalized_cost_lines",
            rowId: expenseId,
            fieldName: canonicalKey,
            value: value as any,
            editedBy: userId ?? null,
            note: overrideComment.trim(),
          });
        }
        if (Object.keys(untrackedFields).length > 0) {
          await storage.updateProgramExpenseFields(expenseId, untrackedFields);
        }
      }
    }

    res.json({ message: "Expenditure overrides applied successfully", count: overrides.length });

    // Refresh dashboard metrics for affected projects
    try {
      const allProjectInfoRows = await storage.getAllProjectInfo();
      const nameToId = new Map(allProjectInfoRows.map((p: any) => [p.projectName, p.id]));
      for (const pn of projectNames) {
        const pid = nameToId.get(pn);
        if (pid) refreshProjectMetricsAsync(pid);
      }
    } catch (metricsErr: any) {
      console.warn("[finance] Expenditure override metrics refresh failed:", metricsErr.message);
    }
  } catch (error) {
    console.error("Failed to save expenditure overrides:", error);
    res.status(500).json({ error: "Failed to save expenditure overrides" });
  }
});

router.delete("/api/expenditure/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    // Override tables collapsed into base tables — no separate overrides to delete
    res.json({ message: `Expenditure overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete expenditure overrides", message: "Failed to delete expenditure overrides" });
  }
});

// ==================== EXPENSE TASK LINKS API ====================

router.get("/api/expense-task-links/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const links = await storage.getExpenseTaskLinks(paramStr(req.params.projectName));
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
    const link = await storage.upsertExpenseTaskLink(paramStr(req.params.projectName), expenseId, taskId, (req.user as any)?.id);

    try {
      await recordOverride({
        actorUserId: (req as any).user?.id,
        actorRole: (req as any).user?.role,
        entityType: "expense_task_link",
        entityId: `${paramStr(req.params.projectName)}|expense${expenseId}`,
        projectName: decodeURIComponent(paramStr(req.params.projectName)),
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
    const expenseId = parseIntParam(req.params.expenseId);
    await storage.deleteExpenseTaskLink(paramStr(req.params.projectName), expenseId);

    try {
      await recordOverride({
        actorUserId: (req as any).user?.id,
        actorRole: (req as any).user?.role,
        entityType: "expense_task_link",
        entityId: `${paramStr(req.params.projectName)}|expense${expenseId}`,
        projectName: decodeURIComponent(paramStr(req.params.projectName)),
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
    const expProjectName = paramStr(req.params.projectName);
    await storage.updateExpenseTaskLinkDateOverride(expProjectName, parseIntParam(req.params.expenseId), dateOverride, reason);

    res.json({ success: true });

    // Refresh dashboard metrics for this project
    try {
      const allProjectInfoRows = await storage.getAllProjectInfo();
      const proj = allProjectInfoRows.find((p: any) => p.projectName === expProjectName);
      if (proj) refreshProjectMetricsAsync(proj.id);
    } catch (metricsErr: any) {
      console.warn("[finance] Expense date override metrics refresh failed:", metricsErr.message);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to save date override" });
  }
});

// ==================== MANUAL EXPENSE ROWS API ====================

router.post("/api/expenses/add-line", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { projectName, expenseCategory, expenseLineItem, expenseActualTotal, expensePoNumber, expenseInvoiceNumber, expenseInvoicedDate, expensePaymentDate, idempotencyKey } = req.body;
    if (!projectName || !expenseCategory) {
      return res.status(400).json({ error: "projectName and expenseCategory are required" });
    }
    const { rows: maxRow } = await getCanonicalProjectCostLinesByName(projectName);
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
      idempotencyKey: idempotencyKey || undefined,
    } as any);

    res.json(newExpense);
  } catch (error) {
    console.error("Add expense line error:", error);
    res.status(500).json({ error: "Failed to add expense line item" });
  }
});

router.post("/api/expenses/add-category", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { projectName, categoryName, idempotencyKey } = req.body;
    if (!projectName || !categoryName) {
      return res.status(400).json({ error: "projectName and categoryName are required" });
    }
    const { rows: maxRow } = await getCanonicalProjectCostLinesByName(projectName);
    const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
    const newCategory = await storage.createManualExpense({
      projectName,
      rowNumber: maxRowNum + 1,
      rowType: 'category',
      expenseCategory: categoryName,
      expenseLineItem: categoryName,
      idempotencyKey: idempotencyKey || undefined,
    } as any);

    res.json(newCategory);
  } catch (error) {
    console.error("Add category error:", error);
    res.status(500).json({ error: "Failed to add category" });
  }
});

router.post("/api/expenses/insert-task-as-line", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { projectName, taskId, expenseCategory, idempotencyKey } = req.body;
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
    const { rows: maxRow } = await getCanonicalProjectCostLinesByName(projectName);
    const maxRowNum = maxRow.reduce((max: number, r: any) => Math.max(max, r.rowNumber || 0), 0);
    const newExpense = await storage.createManualExpense({
      projectName,
      rowNumber: maxRowNum + 1,
      rowType: 'item',
      expenseCategory,
      expenseLineItem: taskTitle,
      expensePaymentDate: taskEndDate,
      lineStatus: 'Planned',
      idempotencyKey: idempotencyKey || undefined,
    } as any);
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
    const projectName = paramStr(req.params.projectName);
    const projectIdParam = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
    const [projectLookup, taskLinks, opTasks, planTasks, projectRows, revSummary] = await Promise.all([
      getHighRiskProjectCostReadRows(projectName, projectIdParam).then((rows) => ({
        projectId: Number.isFinite(projectIdParam) ? (projectIdParam as number) : null,
        rows,
      })),
      storage.getExpenseTaskLinks(projectName),
      storage.getOperationalTasksByProject(projectName),
      storage.getProjectPlansByProject(projectName),
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
    const expenses = projectLookup.rows;

    const cosOverrideByExpenseId = new Map();
    const cosOverrideByRow = new Map();
    const overrideByFieldKey = new Map();
    const governance = await loadProjectFinanceGovernanceContext(
      projectName,
      projectRows[0]?.id ?? null,
      []
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

      const effectivePaymentDate = link?.dateOverride || linkedTask?.dueDate || exp.expensePaymentDate || exp.forecastPaymentDate || null;
      const hasPayDate = !!(effectivePaymentDate && String(effectivePaymentDate).trim());
      const isFutureDate = hasPayDate && new Date(effectivePaymentDate!) > new Date();
      const paymentDateBlack = hasPayDate && !isFutureDate && isDateConfirmed(exp.paymentDateConfirmed, exp.paymentDateFontColor);

      let paymentStatus: string;
      if (paymentDateBlack && hasInvoice) {
        paymentStatus = 'Out of Bank';
      } else if (paymentDateBlack && !hasInvoice) {
        paymentStatus = 'Risk';
      } else if (hasPayDate && !paymentDateBlack && hasInvoice) {
        paymentStatus = 'Outstanding';
      } else {
        paymentStatus = 'Planned';
      }
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
        paymentDateFontColor: isFutureDate ? "red" : (exp.paymentDateFontColor || null),
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
    const overriddenRowCount = 0;
    const overriddenFieldCount = 0;
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
    const overrides = await (storage as any).getFinanceRevenueOverridesByProject(projectName);
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
    const saved = await (storage as any).upsertManyFinanceRevenueOverrides(overridesWithUser);

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

    // Refresh dashboard metrics for affected projects
    try {
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))];
      const allProjectInfoRows = await storage.getAllProjectInfo();
      const nameToId = new Map(allProjectInfoRows.map((p: any) => [p.projectName, p.id]));
      for (const pn of projectNames) {
        const pid = nameToId.get(pn);
        if (pid) refreshProjectMetricsAsync(pid);
      }
    } catch (metricsErr: any) {
      console.warn("[finance] Finance revenue override metrics refresh failed:", metricsErr.message);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to save finance revenue overrides" });
  }
});

router.delete("/api/finance/revenue/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await (storage as any).deleteFinanceRevenueOverridesByProject(projectName);
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
    const overrides = await (storage as any).getFinanceCosOverridesByProject(projectName);
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
    const saved = await (storage as any).upsertManyFinanceCosOverrides(overridesWithUser);

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

    // Refresh dashboard metrics for affected projects
    try {
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))];
      const allProjectInfoRows = await storage.getAllProjectInfo();
      const nameToId = new Map(allProjectInfoRows.map((p: any) => [p.projectName, p.id]));
      for (const pn of projectNames) {
        const pid = nameToId.get(pn);
        if (pid) refreshProjectMetricsAsync(pid);
      }
    } catch (metricsErr: any) {
      console.warn("[finance] Finance COS override metrics refresh failed:", metricsErr.message);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to save finance COS overrides" });
  }
});

router.delete("/api/finance/cos/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectName = req.params.projectName;
    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: "Project name required", message: "Project name is required" });
    }
    await (storage as any).deleteFinanceCosOverridesByProject(projectName);
    res.json({ message: `Finance COS overrides deleted for project: ${projectName}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete finance COS overrides", message: "Failed to delete finance COS overrides" });
  }
});

// ==================== FINANCE REVENUE & COS DATA ====================

function maxCreatedAtIso(rows: Array<{ createdAt?: Date | string | null }>): string | undefined {
  let maxMs = 0;
  for (const r of rows) {
    const c = r.createdAt;
    if (!c) continue;
    const t = c instanceof Date ? c.getTime() : Date.parse(String(c));
    if (Number.isFinite(t) && t > maxMs) maxMs = t;
  }
  return maxMs > 0 ? new Date(maxMs).toISOString() : undefined;
}

router.get("/api/finance/revenue", requireAuth, async (req, res) => {
  try {
    const { projectName, startDate, endDate, applyOverrides } = req.query;
    let data;

    if (projectName && typeof projectName === 'string') {
      data = await storage.getFinanceRevenueMonthlyByProject(projectName);
    } else {
      data = await storage.getAllFinanceRevenueMonthly();
    }

    if (startDate && typeof startDate === 'string') {
      data = data.filter(d => d.monthEndDate >= startDate);
    }
    if (endDate && typeof endDate === 'string') {
      data = data.filter(d => d.monthEndDate <= endDate);
    }

    setFinanceTrustHeaders(res, {
      sourceLayer: "derived",
      derivedTable: "finance_revenue_monthly",
      canonicalTable: "normalized_revenue_lines",
      staleAfterSeconds: 900,
      refreshedAt: maxCreatedAtIso(data),
    });

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
    } else {
      data = await storage.getAllFinanceCosMonthly();
    }

    if (startDate && typeof startDate === 'string') {
      data = data.filter(d => d.monthEndDate >= startDate);
    }
    if (endDate && typeof endDate === 'string') {
      data = data.filter(d => d.monthEndDate <= endDate);
    }

    setFinanceTrustHeaders(res, {
      sourceLayer: "derived",
      derivedTable: "finance_cos_monthly",
      canonicalTable: "normalized_cost_lines",
      staleAfterSeconds: 900,
      refreshedAt: maxCreatedAtIso(data),
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch finance COS data", message: "Failed to fetch finance COS data" });
  }
});

export function registerFinanceRoutes(app: Express) {
  app.use(router);
}
