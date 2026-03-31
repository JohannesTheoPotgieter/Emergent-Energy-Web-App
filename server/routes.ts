/**
 * DEPRECATION STATUS: FROZEN — DO NOT ADD NEW ROUTES HERE
 * Migration target: server/routes/<domain>-routes.ts
 * Progress: docs/route-migration-status.md
 *
 * Total handlers at freeze: 187. Target: 0.
 * New routes MUST go in server/routes/ or server/departments/ domain files.
 */
// TODO: remove @ts-nocheck
// @ts-nocheck
import { toCanonicalEngineeringStageStatus } from "@shared/status-logic";
import { assertTaskWorkflowTransition, buildTaskWorkflowContext, TaskWorkflowGuardError } from "./lib/task-workflow-guard";
import { softCloseByProjectName, addTemporalColumns } from "./lib/temporal-helpers";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { sanitizeFilename, allowedFileFilter } from "./lib/upload-security";
import { fileTypeFromBuffer } from "file-type";
import { storage } from "./storage";
import { parseTrackerFile, applyFontColors } from "./excelParser";
import { projectInfo, normalizedCostLines, normalizedRevenueLines, normalizedExecutionPhases, smartImportRuns, users, notifications, notificationThrottle, mytoolTasks, mytoolTaskDependencies, mytoolRecurrenceTemplates, mytoolRecurrenceInstances, qcItemInstance, qcChecklist, qcTemplateItem, planEditNotifications, workItems, workItemAssignments, clients, projectClientHistory, trItems, deliverables, uploadMetadata, cashflowPoints, financeRevenueMonthly, financeCosMonthly, manualEditFlags, entityAssignments, programExpense, financialEditRequests } from "@shared/schema";
import { inlineEdit } from "./lib/inline-edit-helper";
import { db } from "./db";
import { eq, and, or, sql, isNull, asc, desc, inArray } from "drizzle-orm";
import { runSmartImportPreview } from "./lib/import/index";
import { z } from "zod";
import { format } from "date-fns";
import { requireAuth } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { calculateCPM, applyOverridesToTasks, applyOverridesToDependencies, type CPMDependency } from "./cpmEngine";
import { classifyExpenseState } from "./lib/calculations/stateClassifier";
import { scoreExpenseConfidence, scoreInflowConfidence, getAssumptionDriver } from "./lib/calculations/confidence";
import { aggregateCOS, aggregateCOSByProject } from "./lib/calculations/cosAggregator";
import { computeWeeklyCashflow, getLinesForWeek, type CashflowLineItem } from "./lib/calculations/cashflow";
import { runDataQualityChecks } from "./lib/calculations/dataQuality";
import { computeMonthlyBuckets } from "./lib/calculations/scenarioResolver";
import { recordOverride, recordManualEdit } from "./lib/audit/diff-engine";
import { OVERRIDE_CATEGORIES } from "@shared/schema";

/** Record a manual edit flag for conflict detection during smart import */
async function recordManualEditFlag(opts: {
  entityType: string;
  entityId: number;
  fieldName: string;
  editedByUserId?: number;
  editedByName?: string;
}) {
  try {
    // Upsert: update editedAt if flag already exists, otherwise create
    const existing = await db
      .select({ id: manualEditFlags.id })
      .from(manualEditFlags)
      .where(and(
        eq(manualEditFlags.entityType, opts.entityType),
        eq(manualEditFlags.entityId, opts.entityId),
        eq(manualEditFlags.fieldName, opts.fieldName),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(manualEditFlags)
        .set({ editedAt: new Date(), editedByUserId: opts.editedByUserId || null, editedByName: opts.editedByName || null })
        .where(eq(manualEditFlags.id, existing[0].id));
    } else {
      await db.insert(manualEditFlags).values({
        entityType: opts.entityType,
        entityId: opts.entityId,
        fieldName: opts.fieldName,
        editedByUserId: opts.editedByUserId || null,
        editedByName: opts.editedByName || null,
      });
    }
  } catch (err: any) {
    console.warn("[manual-edit-flag] Failed to record:", err.message);
  }
}
import { requirePermission } from "./permission-middleware";
import { createNameResolver, mapCostToExpenseInput } from "./lib/data-merge";
import { logAuditFromReq } from "./audit-logger";
import { isWorkItemsEnabled, getWorkItemsAsNormalizedPlanTasks, getAllWorkItemsForPlanTab, getWorkItemsAsOperationalTasks, getWorkItemsAsMytoolTasks, getAllPMWorkItemsAsProjectPlan } from "./work-items-adapter";
import { ApiError, sendError, badRequest, notFound, validationError, unauthorized, serverError, logApiError } from "./lib/api-error";
import { validateTaskCreate, validateTaskUpdate } from "./lib/task-validation";
import { normalizeStatus, normalizePriority } from "./lib/canonical-task-engine";
import { getFeatureFlag, getFeatureFlags } from "./lib/feature-flags";
import { requireTrackerPermission } from "./lib/finance-route-access";
import { registerAuthRoutes } from "./routes/auth-routes";
import {
  compareCoreClientsReadiness,
  compareCoreProjectsReadiness,
  getCoreMasterDataReadinessReport,
  listProjectInfoFromPromotedCoreCompat,
  listClientsFromPromotedCoreCompat,
  listProjectDetailFromPromotedCoreCompat,
  buildWorkItemSummaryDiagnostics,
  compareProjectDetailMasterReadiness,
  compareImportsGovernanceReadiness,
  getDomainRolloutReadinessReport,
  getCutoverPostValidationReport,
} from "./services/promoted-read-compat";
import {
  softDeleteCanonicalWorkItemByLegacyTaskId,
} from "./canonical-boundaries";
import { listImportSyncState } from "./services/imports-governance-service";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import { getPlatformProjectSummaryMap } from "./services/project-platform-summary-service";
import { classifyProjectInfoPayload } from "./services/source-of-truth-policy";
import { mytoolTaskIdempotencyStore } from "./lib/mytool-task-idempotency";
import { registerWorkingPlanRoutes } from "./routes/working-plan-routes";
import { registerOperationalTasksRoutes } from "./routes/operational-tasks-routes";
import { registerCosControlRoutes } from "./routes/cos-control-routes";
import { registerPlanningTasksRoutes } from "./routes/planning-tasks-routes";
import { registerDashboardRoutes } from "./routes/dashboard-routes";

const CANONICAL_TO_MYTOOL_STATUS: Record<string, string> = {
  todo: "planned",
  in_progress: "in_progress",
  blocked: "blocked",
  review: "waiting",
  complete: "done",
  cancelled: "cancelled",
};
function toMytoolDbStatus(canonical: string): string {
  return CANONICAL_TO_MYTOOL_STATUS[canonical] || CANONICAL_TO_MYTOOL_STATUS[canonical.toLowerCase()] || "planned";
}
const CANONICAL_TO_MYTOOL_PRIORITY: Record<string, string> = {
  P1: "critical", p1: "critical", urgent: "critical", critical: "critical",
  P2: "high", p2: "high", high: "high",
  P3: "normal", p3: "normal", medium: "normal", normal: "normal",
  P4: "low", p4: "low", low: "low",
};
function toMytoolDbPriority(priority: string): string {
  return CANONICAL_TO_MYTOOL_PRIORITY[priority] || CANONICAL_TO_MYTOOL_PRIORITY[priority.toLowerCase()] || "normal";
}
import { computeNextRecurrenceDate, computeMilestoneProgress, isOverdue, shouldBlockTask, validateDependencyPair } from "./lib/mytool-work-engine";
import { computeScheduleRag, computeCostRag, computeQualityRag, computeOverallRag, DEFAULT_RAG_THRESHOLDS } from "@shared/kpi-definitions";
import { STATIC_COS_BUDGET_FY26 } from "./lib/calculations/financeUtils";
import { isDateConfirmedCheck, getMergedExpensesAndInflows, resolveInflowEffectiveDates } from "./lib/cashflow-helpers";

function isCosRealisedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasInvDate = !!(exp.expenseInvoicedDate && String(exp.expenseInvoicedDate).trim());
  if (!hasInvoice || !hasInvDate) return false;
  const invoiceDateBlack = isDateConfirmedCheck(exp.invoiceDateConfirmed, exp.invoiceDateFontColor);
  return invoiceDateBlack;
}

function isCashflowConfirmedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  const payDateConfirmed = isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);
  return payDateConfirmed;
}

async function enrichMytoolTasks(userId: number, tasks: any[]) {
  if (!tasks.length) return tasks;
  const ids = tasks.map((t) => t.id);
  const deps = await db.select().from(mytoolTaskDependencies).where(or(inArray(mytoolTaskDependencies.predecessorTaskId, ids), inArray(mytoolTaskDependencies.successorTaskId, ids)));
  const taskById = new Map<number, any>(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    const blockedBy = deps.filter((d) => d.successorTaskId === task.id).map((d) => {
      const predecessor = taskById.get(d.predecessorTaskId);
      return { ...d, predecessorStatus: predecessor?.status ?? null, predecessorTitle: predecessor?.title ?? null };
    });
    const blocking = deps.filter((d) => d.predecessorTaskId === task.id).map((d) => {
      const successor = taskById.get(d.successorTaskId);
      return { ...d, successorStatus: successor?.status ?? null, successorTitle: successor?.title ?? null };
    });

    const blockersIncomplete = blockedBy.filter((d) => shouldBlockTask([d.predecessorStatus]));
    task.blockedBy = blockedBy;
    task.blocking = blocking;
    task.blockedByCount = blockersIncomplete.length;
    task.isBlockedByDependencies = blockersIncomplete.length > 0;
    task.isOverdue = isOverdue(task.dueAt, task.status);
  }

  const milestoneIds = tasks.filter((t) => t.taskType === "milestone").map((t) => t.id);
  for (const mId of milestoneIds) {
    const milestone = taskById.get(mId);
    if (milestone) {
      milestone.milestoneTaskCount = 0;
      milestone.milestoneProgress = 0;
    }
  }

  return tasks;
}

async function refreshDependentTaskStates(_taskId: number) {
}


// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for disk storage
const upload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
      cb(null, `${randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
      'application/vnd.ms-excel'
    ];
    if (allowedMimes.includes(file.mimetype) || 
        file.originalname.endsWith('.xlsx') || 
        file.originalname.endsWith('.xlsm') ||
        file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files (.xlsx, .xlsm, .xls) are allowed.'));
    }
  }
});

// Helper functions to apply overrides to baseline data

// Get week start date (Monday) for a given date string
// Parse as UTC to avoid timezone drift issues
function getWeekStartDate(dateStr: string): string {
  // Parse date string as YYYY-MM-DD without timezone shift
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  
  // Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
  const dayOfWeek = d.getUTCDay();
  
  // Calculate days to subtract to get to Monday (weekStartsOn: 1)
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday -> 6 days back, else dayOfWeek - 1
  d.setUTCDate(d.getUTCDate() - diff);
  
  return d.toISOString().split('T')[0];
}

// Calculate Revenue Recognition series from expense data
// COS is recognized when BOTH Invoice Number AND Invoice Raised Date are present (per user requirement)
function calculateRevenueRecognition(
  expenses: any[],
  projectName: string | null
): { weekly: Map<string, Map<string, number>>, cumulative: Map<string, Map<string, number>> } {
  const weekly = new Map<string, Map<string, number>>();
  const cumulative = new Map<string, Map<string, number>>();
  
  // Filter expenses for the project: require BOTH invoice number AND invoice date for COS recognition
  const relevantExpenses = expenses.filter(e => 
    (!projectName || e.projectName === projectName) &&
    e.expenseInvoiceNumber && // Must have invoice number
    e.expenseInvoicedDate && // Must have invoice date
    (e.actualCosTotal || e.expenseActualTotal) &&
    parseFloat(e.actualCosTotal || e.expenseActualTotal || "0") !== 0
  );
  
  // Group by project and week, using actual COS total for recognition
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
  
  // Calculate cumulative for each project
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

// Apply planning overrides to cashflow baseline data
function applyPlanningOverrides(
  baselinePoints: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselinePoints;

  // Create override lookup map: projectName|weekStartDate|seriesName -> overrideValue (parsed as number)
  const overrideMap = new Map<string, number>();
  overrides.forEach((o: any) => {
    const key = `${o.projectName}|${o.weekStartDate}|${o.seriesName}`;
    // Parse override value to number to maintain type consistency
    const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
    if (!isNaN(numValue)) {
      overrideMap.set(key, numValue);
    }
  });

  // Apply overrides to baseline points
  return baselinePoints.map((point: any) => {
    const key = `${point.projectName}|${point.pointDate}|${point.seriesName}`;
    if (overrideMap.has(key)) {
      return {
        ...point,
        value: overrideMap.get(key)!,
      };
    }
    return point;
  });
}

// Apply project plan overrides to tasks/milestones
const NUMERIC_PLAN_FIELDS = new Set(["actualPctComplete", "expectedPctComplete", "durationDays", "parentRowNumber", "indentLevel", "sortOrder"]);
const BOOLEAN_PLAN_FIELDS = new Set(["isMilestone"]);

function coercePlanOverride(fieldName: string, value: any): any {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC_PLAN_FIELDS.has(fieldName)) {
    const num = Number(value);
    return isNaN(num) ? null : num;
  }
  if (BOOLEAN_PLAN_FIELDS.has(fieldName)) {
    return value === true || value === "true";
  }
  return value;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN") {
    return next();
  }
  res.status(403).json({ error: "admin_required", message: "Admin access required", code: "ADMIN_REQUIRED" });
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role && roles.includes(req.user.role)) {
      return next();
    }
    res.status(403).json({ error: "forbidden", message: `Requires one of: ${roles.join(', ')}`, code: "ROLE_REQUIRED" });
  };
}

function requireQmChallenge(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  if ((req.session as any)?.qmChallengePassed) return next();
  res.status(403).json({ error: "qm_challenge_required", message: "Quality Manager access code required", code: "QM_CHALLENGE_REQUIRED" });
}

function requireEpmChallenge(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  if ((req.session as any)?.epmChallengePassed) return next();
  res.status(403).json({ error: "epm_challenge_required", message: "Engineering Program Manager access code required", code: "EPM_CHALLENGE_REQUIRED" });
}

function requireAdminOrEpm(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN" || role === "eng_program_manager" || role === "ENGINEERING_MANAGER") return next();
  res.status(403).json({ error: "forbidden", message: "Admin or Engineering Program Manager access required", code: "ROLE_REQUIRED" });
}

const PLAN_CHANGE_NOTIFY_ROLES = ['PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'];

async function sendPlanChangeNotifications(
  projectName: string,
  changedByUserId: number | undefined,
  changeDescription: string,
  changeDetails: { field?: string; oldValue?: string; newValue?: string; tasks?: string[]; operation?: string }[]
) {
  try {
    const recipients = await db.select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(inArray(users.role, PLAN_CHANGE_NOTIFY_ROLES));

    if (recipients.length === 0) return;

    const [changedByUser] = changedByUserId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, changedByUserId))
      : [{ name: "System" }];

    const detailsJson = JSON.stringify({ projectName, changedBy: changedByUser?.name || "Unknown", changes: changeDetails, timestamp: new Date().toISOString() });
    for (const recipient of recipients) {
      if (recipient.id === changedByUserId) continue;
      await db.insert(notifications).values({
        recipientUserId: recipient.id,
        eventType: "plan_change",
        title: `Plan updated: ${projectName}`,
        body: changeDescription,
        projectName,
        changeDetails: detailsJson,
      });
    }
  } catch (err: any) {
    console.warn("[plan-notify] Failed to send plan change notifications:", err.message);
  }
}

async function notifyWorkItemWatchers(params: {
  workItemId: number;
  actorUserId?: number;
  projectName: string;
  title: string;
  body: string;
  eventType?: string;
}) {
  try {
    const watcherRows = await db
      .select({ userId: workItemAssignments.userId })
      .from(workItemAssignments)
      .where(and(eq(workItemAssignments.workItemId, params.workItemId), eq(workItemAssignments.role, "VIEWER")));

    if (!watcherRows.length) return;

    for (const watcher of watcherRows) {
      if (params.actorUserId && watcher.userId === params.actorUserId) continue;
      await db.insert(notifications).values({
        recipientUserId: watcher.userId,
        eventType: params.eventType || "watcher_update",
        title: params.title,
        body: params.body,
        projectName: params.projectName,
        linkedTaskId: params.workItemId,
        changeDetails: JSON.stringify({ source: "watcher_notification", workItemId: params.workItemId }),
      });
    }
  } catch (error: any) {
    console.warn("[watcher-notify] Failed to notify watchers:", error?.message || error);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  const EXECUTION_PHASES = [
    "Construction", "QA", "Commissioning", "Handover", "Compliance Handover",
    "Commercial Close Out", "Commercial Close out", "DLP", "Financial Close",
    "Planning", "Cost Proposal"
  ];

  function safeguardImportProjectInfo(info: any): any {
    if (info.phase && !info.executionPhase) {
      info.executionPhase = info.phase;
    }
    const phase = info.executionPhase || info.phase || "";
    info.executionEnabled = EXECUTION_PHASES.some(p => p.toLowerCase() === phase.toLowerCase());
    return info;
  }

  // ==================== UNIVERSAL SEARCH ====================

  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim().toLowerCase();
      if (!q || q.length < 2) return res.json({ results: [] });
      const lim = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const startsWithPattern = `${q}%`;
      const containsPattern = `%${q}%`;

      const [projectRows, workItemRows, costRows, revenueRows] = await Promise.all([
        db.execute(sql`
          SELECT id, project_name, phase, pd, pm, size_kwp
          FROM project_info
          WHERE LOWER(project_name) LIKE ${startsWithPattern}
             OR LOWER(project_name) LIKE ${containsPattern}
          ORDER BY CASE WHEN LOWER(project_name) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, project_name
          LIMIT ${lim}
        `),
        db.execute(sql`
          SELECT w.id, w.title, w.status, p.project_name, w.type as task_type, w.owner_name as assigned_to, w.percent_complete
          FROM work_items w
          LEFT JOIN project_info p ON w.project_id = p.id
          WHERE LOWER(w.title) LIKE ${containsPattern}
             OR LOWER(p.project_name) LIKE ${containsPattern}
          ORDER BY CASE WHEN LOWER(w.title) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, w.title
          LIMIT ${lim}
        `),
        db.execute(sql`
          SELECT id, description, project_name, cost_category as category, counterparty_name as supplier, amount_ex_vat as total_cost, cost_line_status as status, invoice_number, po_number
          FROM normalized_cost_lines
          WHERE LOWER(description) LIKE ${containsPattern}
             OR LOWER(counterparty_name) LIKE ${containsPattern}
             OR LOWER(cost_category) LIKE ${containsPattern}
             OR LOWER(COALESCE(invoice_number, '')) LIKE ${containsPattern}
             OR LOWER(COALESCE(po_number, '')) LIKE ${containsPattern}
          ORDER BY CASE WHEN LOWER(COALESCE(invoice_number, '')) LIKE ${startsWithPattern} OR LOWER(COALESCE(po_number, '')) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, description
          LIMIT ${lim}
        `),
        db.execute(sql`
          SELECT id, description, project_name, milestone_name, amount_ex_vat as amount, status, invoice_number
          FROM normalized_revenue_lines
          WHERE LOWER(description) LIKE ${containsPattern}
             OR LOWER(milestone_name) LIKE ${containsPattern}
             OR LOWER(COALESCE(invoice_number, '')) LIKE ${containsPattern}
          ORDER BY CASE WHEN LOWER(COALESCE(invoice_number, '')) LIKE ${startsWithPattern} THEN 0 ELSE 1 END, description
          LIMIT ${lim}
        `),
      ]);

      const results: any[] = [];
      const getRows = (result: any): any[] => Array.isArray(result) ? result : (result?.rows || []);

      for (const r of getRows(projectRows)) {
        results.push({
          type: "project",
          id: r.project_name,
          title: r.project_name,
          subtitle: [r.phase, r.pm ? `PM: ${r.pm}` : null, r.size_kwp ? `${r.size_kwp} kWp` : null].filter(Boolean).join(" · "),
          url: `/project/${encodeURIComponent(r.project_name)}`,
        });
      }
      for (const r of getRows(workItemRows)) {
        results.push({
          type: "task",
          id: `wi-${r.id}`,
          title: r.title,
          subtitle: [r.project_name, r.task_type, r.status, r.percent_complete != null ? `${Math.round(r.percent_complete * 100)}%` : null].filter(Boolean).join(" · "),
          url: r.project_name ? `/project/${encodeURIComponent(r.project_name)}?tab=plan` : null,
        });
      }
      for (const r of getRows(costRows)) {
        results.push({
          type: "cost",
          id: `cost-${r.id}`,
          title: r.description || r.category || "Cost item",
          subtitle: [r.project_name, r.supplier, r.invoice_number ? `INV: ${r.invoice_number}` : null, r.po_number ? `PO: ${r.po_number}` : null, r.category, r.total_cost ? `R${Number(r.total_cost).toLocaleString()}` : null].filter(Boolean).join(" · "),
          url: r.project_name ? `/project/${encodeURIComponent(r.project_name)}?tab=expenditure` : null,
        });
      }
      for (const r of getRows(revenueRows)) {
        results.push({
          type: "revenue",
          id: `rev-${r.id}`,
          title: r.description || r.milestone_name || "Revenue item",
          subtitle: [r.project_name, r.milestone_name, r.invoice_number ? `INV: ${r.invoice_number}` : null, r.amount ? `R${Number(r.amount).toLocaleString()}` : null].filter(Boolean).join(" · "),
          url: r.project_name ? `/project/${encodeURIComponent(r.project_name)}?tab=revenue` : null,
        });
      }

      res.json({ results: results.slice(0, lim) });
    } catch (err: any) {
      console.error("Search error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  // ==================== FEATURE FLAGS ====================

  app.get("/api/settings", requireAuth, async (req, res) => {
    try {
      const key = req.query.key as string;
      if (!key) return res.status(400).json({ error: "key parameter required" });
      const { getFeatureFlag } = await import("./lib/feature-flags");
      const value = await getFeatureFlag(key);
      res.json({ key, value });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get setting" });
    }
  });

  app.put("/api/settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: "key is required" });
      const { setFeatureFlag } = await import("./lib/feature-flags");
      await setFeatureFlag(key, !!value, (req as any).user?.name || "admin");
      logAuditFromReq(req, { entityType: "settings", action: "update", changesJson: { key, value: !!value }, source: "SETTINGS" });
      res.json({ success: true, key, value: !!value });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update setting" });
    }
  });

  app.get("/api/feature-flags/rollout", requireAuth, async (req, res) => {
    try {
      const { getRolloutFeatureFlags } = await import("./lib/feature-flags");
      const { ROLLOUT_FEATURE_FLAGS } = await import("@shared/feature-flags");
      const values = await getRolloutFeatureFlags();
      res.json({
        flags: ROLLOUT_FEATURE_FLAGS.map((flag) => ({
          key: flag.key,
          label: flag.label,
          description: flag.description,
          defaultValue: flag.defaultValue,
          value: values[flag.key],
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch rollout feature flags" });
    }
  });

  app.post("/api/ux/role-aware-interaction", requireAuth, async (req, res) => {
    try {
      const action = String(req.body?.action || "");
      const suggestion = String(req.body?.suggestion || "");
      const finalValue = String(req.body?.finalValue || "");
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const role = typeof req.body?.role === "string" ? req.body.role : null;

      if (!["suggestion_accepted", "suggestion_overridden"].includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }
      if (!suggestion || !finalValue) {
        return res.status(400).json({ error: "suggestion and finalValue are required" });
      }
      if (action === "suggestion_overridden" && !reason) {
        return res.status(400).json({ error: "reason is required for overrides" });
      }

      logAuditFromReq(req, {
        source: "UI",
        entityType: "role_aware_shell",
        action,
        changesJson: {
          suggestion,
          finalValue,
          reason: reason || null,
          role,
        },
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to log interaction" });
    }
  });

  // ==================== HEALTH CHECK ====================
  
  app.get("/api/version", async (_req, res) => {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      if (process.env.NODE_ENV === "production") {
        const bvPath = path.default.resolve("dist/public/build-version.json");
        const data = JSON.parse(await fs.readFile(bvPath, "utf-8"));
        let releaseNotes: { title: string; description: string }[] = [];
        try {
          const rnPath = path.default.resolve("dist/public/release-notes.json");
          const rnData = JSON.parse(await fs.readFile(rnPath, "utf-8"));
          releaseNotes = rnData.notes || [];
        } catch {}
        return res.json({ version: data.version, buildTime: data.buildTime, buildId: data.buildId, buildNumber: data.buildNumber || null, releaseNotes });
      }
      const vPath = path.default.resolve("version.json");
      const data = JSON.parse(await fs.readFile(vPath, "utf-8"));
      const version = `${data.major}.${data.minor}.${data.patch}`;
      const lu = data.lastUpdated ? new Date(data.lastUpdated) : new Date();
      const buildNumber = `${String(lu.getFullYear()).slice(2)}${String(lu.getMonth() + 1).padStart(2, "0")}${String(lu.getDate()).padStart(2, "0")}`;
      let releaseNotes: { title: string; description: string }[] = [];
      try {
        const rnPath = path.default.resolve("release-notes.json");
        const rnData = JSON.parse(await fs.readFile(rnPath, "utf-8"));
        releaseNotes = rnData.notes || [];
      } catch {}
      return res.json({ version, buildTime: data.lastUpdated, buildId: null, buildNumber, releaseNotes });
    } catch (error) {
      logApiError("GET /api/version", error);
      return res.json({ version: "0.0.001", buildTime: null, buildId: null, buildNumber: null, releaseNotes: [] });
    }
  });

  app.get("/api/health", async (_req, res) => {
    try {
      const { dbMode } = await import("./db");
      const { getDbConfigStatus } = await import("./db-config");
      const { getStartupModes } = await import("./startup-modes");
      const { buildHealthDiagnostics } = await import("./health-diagnostics");

      const dbStatus = getDbConfigStatus();
      const startupModes = getStartupModes();

      res.json(buildHealthDiagnostics(dbMode, dbStatus, startupModes));
    } catch (error) {
      logApiError("GET /api/health", error);
      return sendError(res, new ApiError(500, "HEALTH_CHECK_FAILED", "Failed to collect health diagnostics."));
    }
  });
  
  // GC-003 + GC-005: Server-side KPI health-summary endpoint with configurable RAG thresholds
  app.get("/api/projects/:projectName/health-summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);

      // Fetch all data in parallel
      const [expenses, inflows, planTasks, qualitySummaryRes, projectInfoRow, engStagesRes, engTasksRes] = await Promise.all([
        storage.getProgramExpensesByProject(decodedName),
        storage.getProgramInflowsByProject(decodedName),
        (async () => {
          const useCanonical = await isWorkItemsEnabled();
          if (useCanonical) {
            return getAllWorkItemsForPlanTab(decodedName);
          }
          return storage.getProjectPlansByProject(decodedName);
        })(),
        (async () => {
          try {
            const rows = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, decodedName));
            if (rows.length === 0) return { hasChecklist: false, phases: [] };
            const checklist = rows[0];
            const items = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
            const phaseMap = new Map<string, { applicableItems: number; approvedItems: number }>();
            for (const item of items) {
              const phase = item.phaseName || "Unknown";
              if (!phaseMap.has(phase)) phaseMap.set(phase, { applicableItems: 0, approvedItems: 0 });
              const p = phaseMap.get(phase)!;
              p.applicableItems++;
              if (item.status === "PASS" || item.status === "N/A") p.approvedItems++;
            }
            return { hasChecklist: true, phases: Array.from(phaseMap.values()) };
          } catch { return { hasChecklist: false, phases: [] }; }
        })(),
        storage.getProjectInfo(decodedName),
        (async () => {
          try {
            const pid = (await storage.getProjectInfo(decodedName))?.id;
            if (!pid) return { stages: [] };
            const stagesRes = await db.query.projectEngStages?.findMany({ where: (s: any, { eq: eq2 }: any) => eq2(s.projectId, pid) });
            return { stages: stagesRes || [] };
          } catch { return { stages: [] }; }
        })(),
        (async () => {
          try {
            const pid = (await storage.getProjectInfo(decodedName))?.id;
            if (!pid) return { tasks: [] };
            // Read from work_items (ENG workstream)
            const tasks = await db.select().from(workItems).where(and(eq(workItems.projectId, pid), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
            return { tasks };
          } catch { return { tasks: [] }; }
        })(),
      ]);

      // Contract value and budget
      const totalRevenueActual = inflows.reduce((s: number, r: any) => s + (Number(r.milestoneAmount) || 0), 0);
      const contractValue = (projectInfoRow as any)?.contractValue || totalRevenueActual || 0;
      const totalBudgetFromExpenses = expenses.reduce((s: number, e: any) => s + (Number(e.budgetTotal) || 0), 0);
      const budgetTotal = (projectInfoRow as any)?.budgetTotal || totalBudgetFromExpenses || 0;

      // Schedule RAG
      const today = new Date().toISOString().split("T")[0];
      const overduePlanTasks = (planTasks as any[]).filter((t: any) => {
        const endDate = t.actualEndDate || t.dueDate || t.actualEnd || t.endDate;
        const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
        const pctNorm = pct > 1 ? pct : pct * 100;
        return endDate && endDate.substring(0, 10) < today && pctNorm < 100;
      });
      const completedPlanTasks = (planTasks as any[]).filter((t: any) => {
        const pct = t.percentComplete != null ? Number(t.percentComplete) : (Number(t.actualPctComplete) || 0);
        const pctNorm = pct > 1 ? pct : pct * 100;
        return pctNorm >= 100;
      });
      const planCompletionPct = planTasks.length > 0 ? (completedPlanTasks.length / planTasks.length) * 100 : 0;
      // Include overdue engineering tasks in schedule health
      const overdueEngTasks = (engTasksRes.tasks || []).filter((t: any) => {
        const due = t.endDate || t.dueDate;
        return due && String(due).substring(0, 10) < today && String(t.status).toUpperCase() !== "COMPLETE";
      });
      const scheduleRag = computeScheduleRag(overduePlanTasks.length + overdueEngTasks.length);

      // Cost RAG
      const totalExpenses = expenses.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
      const costRatio = budgetTotal > 0 ? totalExpenses / budgetTotal : 0;
      const costRag = computeCostRag(costRatio);

      // Quality RAG — combines QC checklist gates with engineering stage gates
      const qualityPhases = qualitySummaryRes.phases || [];
      const qcGatesTotal = qualityPhases.length;
      const qcGatesPassed = qualityPhases.filter((p: any) => p.applicableItems > 0 && p.approvedItems >= p.applicableItems).length;
      const qualityTotalItems = qualityPhases.reduce((s: number, p: any) => s + (p.applicableItems || 0), 0);
      const qualityApprovedItems = qualityPhases.reduce((s: number, p: any) => s + (p.approvedItems || 0), 0);

      // Engineering stages as quality gates
      const engStagesForQuality = engStagesRes.stages || [];
      const engGatesTotal = engStagesForQuality.length;
      const engGatesPassed = engStagesForQuality.filter((s: any) => String(s.status).toLowerCase() === "complete").length;

      // Combined quality gates
      const qualityGatesTotal = qcGatesTotal + engGatesTotal;
      const qualityGatesPassed = qcGatesPassed + engGatesPassed;
      const hasQualityData = qualitySummaryRes.hasChecklist || engGatesTotal > 0;
      const combinedTotalItems = qualityTotalItems + engGatesTotal;
      const combinedApprovedItems = qualityApprovedItems + engGatesPassed;
      const qualityProgressPct = combinedTotalItems > 0 ? (combinedApprovedItems / combinedTotalItems) * 100 : 0;
      const qualityRag = computeQualityRag(hasQualityData, qualityGatesPassed, qualityGatesTotal, combinedApprovedItems);

      // Revenue realised %
      const totalPaidInflows = inflows
        .filter((m: any) => m.inBank === 1 || m.inBank === true)
        .reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const revenueRealisedPct = contractValue > 0 ? (totalPaidInflows / contractValue) * 100 : 0;

      // COS realised %
      const isCosRealised = (e: any) => isCosRealisedCheck(e);
      const totalRealisedCos = expenses.reduce((s: number, e: any) => isCosRealised(e) ? s + (Number(e.expenseActualTotal) || 0) : s, 0);
      const cosDenominator = totalExpenses > 0 ? totalExpenses : budgetTotal;
      const cosRealisedPct = cosDenominator > 0 ? (totalRealisedCos / cosDenominator) * 100 : 0;

      // Overall RAG
      const overallRag = computeOverallRag(scheduleRag, costRag, qualityRag);

      // Engineering progress
      const engStages = engStagesRes.stages || [];
      const engStageTotalTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.length || 0), 0);
      const engStageCompletedTasks = engStages.reduce((s: number, st: any) => s + (st.tasks?.filter((t: any) => String(t.status).toUpperCase() === "COMPLETE").length || 0), 0);
      const engBoardTasks = engTasksRes.tasks || [];
      const engBoardTotal = engBoardTasks.length;
      const engBoardCompleted = engBoardTasks.filter((t: any) => String(t.status).toUpperCase() === "COMPLETE").length;
      const engTotalTasks = engStageTotalTasks + engBoardTotal;
      const engCompletedTasks = engStageCompletedTasks + engBoardCompleted;
      const engProgressPct = engTotalTasks > 0 ? (engCompletedTasks / engTotalTasks) * 100 : 0;

      res.json({
        schedule: { rag: scheduleRag, overdueTasks: overduePlanTasks.length, overdueEngTasks: overdueEngTasks.length, completionPct: Math.round(planCompletionPct * 10) / 10 },
        cost: { rag: costRag, ratio: Math.round(costRatio * 1000) / 1000, totalExpenses, budgetTotal },
        quality: { rag: qualityRag, gatesTotal: qualityGatesTotal, gatesPassed: qualityGatesPassed, qcGatesTotal, qcGatesPassed, engGatesTotal, engGatesPassed, totalItems: combinedTotalItems, approvedItems: combinedApprovedItems, progressPct: Math.round(qualityProgressPct * 10) / 10 },
        revenue: { contractValue, realisedPct: Math.round(revenueRealisedPct * 10) / 10, totalPaidInflows },
        cos: { realisedPct: Math.round(cosRealisedPct * 10) / 10, totalRealised: totalRealisedCos },
        engineering: { progressPct: Math.round(engProgressPct * 10) / 10, totalTasks: engTotalTasks, completedTasks: engCompletedTasks },
        overall: { rag: overallRag },
        alerts: {
          overduePlanTasks: overduePlanTasks.length,
          overdueEngineeringTasks: overdueEngTasks.length,
          pendingQualityApprovals: Math.max(qualityTotalItems - qualityApprovedItems, 0),
        },
      });
    } catch (error: any) {
      logApiError("GET /api/projects/:projectName/health-summary", error);
      res.status(500).json({ error: "Failed to compute project health summary" });
    }
  });

  await registerAuthRoutes(app);

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
              const piNameMap = new Map(piRows.map(p => [p.id, p.projectName]));
              return wiRows.map(wi => ({
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
              const piNameMap = new Map(piRows.map(p => [p.id, p.projectName]));
              return wiRows.map(wi => ({
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

  // ==================== HOME PAGE API (Projects Report) ====================

  // Helper: safely parse number, return 0 for null/undefined/NaN
  function safeNum(value: unknown): number {
    if (value === null || value === undefined || value === '') return 0;
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  // Helper: check if date is within N days from today (for upcoming events)
  function isWithinDays(dateStr: string | null | undefined, days: number): boolean {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateStr);
    const diffMs = targetDate.getTime() - today.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= days;
  }

  // Helper: check if date is within this week (Mon-Sun)
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

  // Helper: check if date is within this month
  function isThisMonth(dateStr: string | null | undefined): boolean {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const today = new Date();
    const target = new Date(dateStr);
    return target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
  }

  // Get FY date range (Sep 1 - Aug 31)
  function getFYRange(date: Date = new Date()): { start: string; end: string } {
    const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1; // Sep=8
    return {
      start: `${year}-09-01`,
      end: `${year + 1}-08-31`
    };
  }

  app.get("/api/home/summary", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, legacyExpenses, legacyRawInflows, legacyPlans, latestRefresh, revenueSummaries, allTaskLinks, allOpTasks, allPlanOverrides, allPlanTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
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

      const todayStr = today;
      const projectDeltas = new Map<string, { weightedActual: number; weightedExpected: number; totalWeight: number }>();
      for (const plan of allPlans) {
        if ((plan as any).rowNumber < 0 && (plan as any).isVirtual) continue;
        const taskNo2 = (plan.taskNo || '').toString().toLowerCase().trim();
        const isSummary2 = taskNo2 === 'no.' || taskNo2 === 'no' || taskNo2 === '#';
        if (isSummary2) continue;
        if (!projectDeltas.has(plan.projectName)) {
          projectDeltas.set(plan.projectName, { weightedActual: 0, weightedExpected: 0, totalWeight: 0 });
        }
        const pd = projectDeltas.get(plan.projectName)!;
        const dur = plan.durationDays && plan.durationDays > 0 ? plan.durationDays : 1;
        pd.weightedActual += (plan.actualPctComplete ?? 0) * dur;
        let exp = plan.expectedPctComplete;
        if (exp == null || exp === undefined) {
          const tStart = plan.actualStart?.substring?.(0, 10) || plan.startDate?.substring?.(0, 10);
          const tEnd = plan.actualEnd?.substring?.(0, 10) || plan.endDate?.substring?.(0, 10);
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
        pd.weightedExpected += (exp ?? 0) * dur;
        pd.totalWeight += dur;
      }

      const projectDeltaValues: { projectName: string; delta: number; avgActual: number; avgExpected: number }[] = [];
      for (const [projectName, pd] of Array.from(projectDeltas.entries())) {
        if (pd.totalWeight > 0) {
          const avgActual = pd.weightedActual / pd.totalWeight;
          const avgExpected = pd.weightedExpected / pd.totalWeight;
          const delta = (avgActual - avgExpected) * 100;
          projectDeltaValues.push({ projectName, delta, avgActual: avgActual * 100, avgExpected: avgExpected * 100 });
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

      // Financial summary - compute from raw data tables
      // If revenueSummaries table has data, use it; otherwise compute from raw inflows/expenses
      let actualRevenue = 0, actualExpenses = 0, currentVoTotal = 0;
      
      const hasRevenueSummaryData = revenueSummaries.length > 0;
      if (hasRevenueSummaryData) {
        for (const rs of revenueSummaries) {
          actualRevenue += safeNum(rs.actualRevenue);
          actualExpenses += safeNum(rs.actualExpenditure);
          currentVoTotal += safeNum(rs.currentVoTotal);
        }
      } else {
        // Fallback: compute from normalized_revenue_lines and normalized_cost_lines using proper in-bank/paid logic
        for (const inflow of allInflows) {
          if (inflow.milestoneAmount) {
            const manualInBank = (inflow as any).inBank === 1 || (inflow as any).inBank === '1' || (inflow as any).inBank === true;
            const hasInvoice = !!(inflow.milestoneInvoiceNumber && String(inflow.milestoneInvoiceNumber).trim());
            const hasPaymentReceived = !!(inflow.paymentReceivedDate && String(inflow.paymentReceivedDate).trim() && inflow.paymentReceivedDate !== '-');
            const isInBank = manualInBank || (hasPaymentReceived && hasInvoice);
            if (isInBank) {
              actualRevenue += safeNum(inflow.milestoneAmount);
            }
          }
        }
        for (const expense of allExpenses) {
          if (expense.expenseActualTotal) {
            const state = classifyExpenseState(expense as any);
            if (state === 'Paid') {
              actualExpenses += safeNum(expense.expenseActualTotal);
            }
          }
        }
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

  // ==================== PROGRAM COS API (fixed) ====================

  app.get("/api/program/cos", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, atRiskDays = '30' } = req.query;
      const atRiskDaysNum = parseInt(atRiskDays as string, 10) || 30;
      
      const [allExpenses, latestRefresh] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getLatestRefresh()
      ]);

      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const fyRange = getFYRange();
      const filterStart = (startDate as string) || fyRange.start;
      const filterEnd = (endDate as string) || fyRange.end;

      // Filter expenses
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

      const _nowCos = new Date();
      const _curMonthEnd = `${_nowCos.getFullYear()}-${String(_nowCos.getMonth() + 1).padStart(2, '0')}-31`;

      for (const exp of filtered) {
        const invoiceDate = exp.expenseInvoicedDate;
        const paymentDate = exp.expensePaymentDate;
        const amount = safeNum(exp.expenseActualTotal);
        const cosAmount = safeNum(exp.actualCosTotal) || amount;
        const budgetAmount = safeNum(exp.budgetTotal);
        const category = exp.expenseCategory || 'Panels';

        totalBudget += budgetAmount;

        if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && invoiceDate <= _curMonthEnd) {
          totalCosRealised += cosAmount;

          // Monthly COS by category
          const monthKey = invoiceDate.substring(0, 7); // YYYY-MM
          if (!monthlyCategoryMap.has(category)) {
            monthlyCategoryMap.set(category, new Map());
          }
          const categoryMonths = monthlyCategoryMap.get(category)!;
          categoryMonths.set(monthKey, (categoryMonths.get(monthKey) || 0) + cosAmount);

          // Project COS
          projectCosMap.set(exp.projectName, (projectCosMap.get(exp.projectName) || 0) + cosAmount);

          // Supplier extraction
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

        // Cash Paid = has payment date within range
        if (paymentDate && paymentDate >= filterStart && paymentDate <= filterEnd) {
          totalCashPaid += amount;
        }

        if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && invoiceDate <= _curMonthEnd && !paymentDate) {
          outstandingCos += cosAmount;

          // At-risk = invoice older than X days and not paid
          const invoiceDateObj = new Date(invoiceDate);
          const daysSinceInvoice = Math.floor((today.getTime() - invoiceDateObj.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceInvoice > atRiskDaysNum) {
            atRiskCount++;
          }
        }
      }

      // Format top suppliers
      const topSuppliers = Array.from(supplierMap.entries())
        .map(([supplier, total]) => ({ supplier, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Format top projects
      const topProjects = Array.from(projectCosMap.entries())
        .map(([project, total]) => ({ project: project.replace('_Tracker', ''), total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Format monthly COS matrix
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

  // ==================== PROJECTS SUMMARY API ====================

  // Timezone-safe date string formatting (avoids toISOString UTC shift issues)
  function formatDateKey(y: number, m: number, d: number): string {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Parse YYYY-MM-DD into { year, month, day } without timezone
  function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
    const s = dateStr.substring(0, 10);
    return { year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)), day: parseInt(s.substring(8, 10)) };
  }

  // South African public holidays (fixed + observed; Easter-based dates computed per year)
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
    add(1, 1);   // New Year's Day
    add(3, 21);  // Human Rights Day
    add(4, 27);  // Freedom Day
    add(5, 1);   // Workers' Day
    add(6, 16);  // Youth Day
    add(8, 9);   // National Women's Day
    add(9, 24);  // Heritage Day
    add(12, 16); // Day of Reconciliation
    add(12, 25); // Christmas Day
    add(12, 26); // Day of Goodwill

    // Easter-based holidays (Good Friday & Family Day) - computed per year
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

  // Count SA working days between start and end (inclusive of both endpoints, matching Excel NETWORKDAYS)
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

  // Helper: find max ActualEndDate from plan tasks matching a description pattern
  function findMaxEndDate(plans: any[], patterns: string[]): string | null {
    let maxDate: string | null = null;
    for (const task of plans) {
      const desc = (task.highLevelProgramme || '').toLowerCase();
      const matches = patterns.some(p => desc.includes(p.toLowerCase()));
      if (!matches) continue;
      const dateVal = task.trueActualEnd || task.actualEnd;
      if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
        const dateStr = dateVal.substring(0, 10);
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
      if (!matches) continue;
      const dateVal = task.trueActualStart || task.actualStart;
      if (dateVal && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
        const dateStr = dateVal.substring(0, 10);
        if (!minDate || dateStr < minDate) minDate = dateStr;
      }
    }
    return minDate;
  }

  // Helper: compute calendar DAYS diff between two date strings (kept for non-workday uses)
  function daysDiff(a: string | null, b: string | null): number | null {
    if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
    const da = new Date(a.substring(0, 10));
    const db = new Date(b.substring(0, 10));
    const diff = Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  }


  app.get("/api/financial-headline", requireAuth, async (_req, res) => {
    try {
      const today = new Date();
      const fyStartMonth = 9;
      let fyStartYear = today.getFullYear();
      if (today.getMonth() + 1 < fyStartMonth) fyStartYear--;
      const fyStart = `${fyStartYear}-09-01`;
      const fyEnd = `${fyStartYear + 1}-08-31`;
      const fyLabel = `FY${String(fyStartYear).slice(2)}/${String(fyStartYear + 1).slice(2)}`;
      const todayStr = today.toISOString().split('T')[0];

      const dateInFY = (dateStr: string | null | undefined): boolean => {
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return false;
        const d = dateStr.substring(0, 10);
        return d >= fyStart && d <= fyEnd;
      };

      const { normalizedCostLines, normalizedRevenueLines, projectInfo, projectExecutionState } = await import("@shared/schema");

      const HARD_EXCLUDED = ["Closed", "Gone"];
      const activeProjectsResult = await db.select({
        projectName: projectInfo.projectName,
        phase: projectExecutionState.executionPhase,
        phaseUpdatedAt: projectExecutionState.phaseUpdatedAt,
      })
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(isNull(projectExecutionState.deletedAt));
      const activeNames = new Set(
        activeProjectsResult
          .filter(p => {
            const phase = p.phase || "";
            if (HARD_EXCLUDED.includes(phase)) return false;
            if (phase === "Compliance Handover") {
              if (!p.phaseUpdatedAt) return false;
              const d = p.phaseUpdatedAt instanceof Date
                ? p.phaseUpdatedAt.toISOString().substring(0, 10)
                : String(p.phaseUpdatedAt).substring(0, 10);
              return d >= fyStart && d <= fyEnd;
            }
            return true;
          })
          .map(p => p.projectName.toLowerCase().trim())
      );

      const [allNormCosts, allNormRev] = await Promise.all([
        db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
        db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
      ]);

      let totalRevenue = 0;
      let totalExpenses = 0;
      let revenueOutstanding = 0;
      let expensesDue = 0;
      let revenueOverdue = 0;
      let expensesOverdue = 0;

      const isValidDate = (d: string | null | undefined): boolean =>
        !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && d !== '-');
      const isPastDate = (d: string): boolean => d.substring(0, 10) < todayStr;

      for (const rev of allNormRev) {
        if (!activeNames.has(rev.projectName.toLowerCase().trim())) continue;
        const dateField = rev.invoiceDate || rev.paidDate || rev.expectedPaymentDate;
        if (!dateInFY(dateField)) continue;

        const amt = parseFloat(rev.amountExVat || '0') || 0;
        if (amt === 0) continue;

        const hasInvoice = !!(rev.invoiceNumber && String(rev.invoiceNumber).trim());
        const hasPaidDate = isValidDate(rev.paidDate);
        const hasPaymentColorInfo = rev.paidDateConfirmed != null || (rev.paidDateFontColor != null && rev.paidDateFontColor !== '');
        const paidDateBlack = hasPaidDate && (rev.paidDateConfirmed === true || rev.paidDateFontColor === 'black' || !hasPaymentColorInfo);
        const isInBank = hasInvoice && paidDateBlack;

        if (isInBank) {
          totalRevenue += amt;
        } else if (hasInvoice) {
          revenueOutstanding += amt;
          const dueDate = rev.expectedPaymentDate || rev.invoiceDate;
          if (isValidDate(dueDate) && isPastDate(dueDate!)) {
            revenueOverdue += amt;
          }
        }
      }

      for (const cost of allNormCosts) {
        if (!activeNames.has(cost.projectName.toLowerCase().trim())) continue;
        const dateField = cost.invoiceDate || cost.paidDate || cost.approvedDate;
        if (!dateInFY(dateField)) continue;

        const amt = parseFloat(cost.amountExVat || '0') || 0;
        if (amt === 0) continue;

        const state = classifyExpenseState(mapCostToExpenseInput(cost));

        if (state === 'Paid') {
          totalExpenses += amt;
        } else if (state === 'Invoiced' || state === 'Committed') {
          expensesDue += amt;
          const dueDate = cost.paidDate || cost.invoiceDate;
          if (isValidDate(dueDate) && isPastDate(dueDate!)) {
            expensesOverdue += amt;
          }
        }
      }

      const grossProfit = totalRevenue - totalExpenses;
      const gpMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      res.json({
        fyLabel,
        fyStart,
        fyEnd,
        totalRevenue,
        totalExpenses,
        grossProfit,
        gpMargin,
        revenueOutstanding,
        expensesDue,
        revenueOverdue,
        expensesOverdue,
      });
    } catch (err: any) {
      console.error("[Financial Headline] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  const docUploadDir = path.join(process.cwd(), 'uploads', 'financial-close');
  if (!fs.existsSync(docUploadDir)) {
    fs.mkdirSync(docUploadDir, { recursive: true });
  }
  const docUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, docUploadDir),
      filename: (_req, file, cb) => {
        const ts = Date.now();
        cb(null, `${ts}_${sanitizeFilename(file.originalname)}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: allowedFileFilter,
  });

  app.post("/api/financial-close/upload", requireAuth, requireAdmin, docUpload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileUrl = `/api/financial-close/files/${req.file.filename}`;
    logAuditFromReq(req, { entityType: "financial_close_doc", action: "upload", entityId: req.file.originalname, changesJson: { description: "Financial close document uploaded", filename: req.file.originalname } });
    res.json({ url: fileUrl, filename: req.file.originalname });
  });

  app.get("/api/financial-close/files/:filename", requireAuth, (req, res) => {
    const filename = req.params.filename as string;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const filePath = path.join(docUploadDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    res.sendFile(filePath);
  });

  // Update project editable fields (Cost Proposal Signed, Funding Signed, EPC Contract Signed, Current VO Total, Comments)
  app.post("/api/projects-summary/:projectName/edit", requireAuth, requireAdmin, async (req, res) => {
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
      });
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

      logAuditFromReq(req, { entityType: "project_info", action: "update", entityId: projectName, projectName, changesJson: { description: "Project summary fields edited", ...parsed } });
      const project = await storage.getProjectInfo(projectName);
      if (project) {
        const changedFields = Object.keys(parsed)
          .filter((key) => parsed[key as keyof typeof parsed] !== undefined)
          .sort();
        const updatedAtKey = result?.updatedAt ? new Date(result.updatedAt).getTime() : Date.now();
        await createProjectEvent({
          projectId: project.id,
          eventType: "project.summary_updated",
          sourceEntityType: "project_editable_fields",
          sourceEntityId: String(project.id),
          summary: "Project summary fields updated",
          details: { changedFields },
          idempotencyKey: `project-summary:${project.id}:${updatedAtKey}:${changedFields.join(",")}`,
          ...actorFromReq(req),
        });
      }
      res.json(result);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return sendError(res, badRequest(error.issues?.map((issue: any) => issue.message).join("; ") || "Validation failed"));
      }
      logApiError("POST /api/projects-summary/:projectName/edit", error);
      return sendError(res, serverError("Failed to save project fields"));
    }
  });

  app.patch("/api/projects-summary/:projectName/latest-update", requireAuth, requirePermission('projects', 'edit'), async (req, res) => {
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

      logAuditFromReq(req, { entityType: "project_info", action: "update_comment", entityId: projectName, projectName, changesJson: { description: "Latest update comment changed", latestUpdate } });
      const project = await storage.getProjectInfo(projectName);
      if (project) {
        const updateAt = result?.latestUpdateAt ? new Date(result.latestUpdateAt).getTime() : 0;
        await createProjectEvent({
          projectId: project.id,
          eventType: "project.latest_update_changed",
          sourceEntityType: "project_editable_fields",
          sourceEntityId: String(project.id),
          summary: latestUpdate ? "Latest project update changed" : "Latest project update cleared",
          details: { latestUpdate: latestUpdate || null },
          idempotencyKey: `latest-update:${project.id}:${updateAt}:${latestUpdate || "clear"}`,
          ...actorFromReq(req),
        });
      }
      res.json(result);
    } catch (error) {
      logApiError("PATCH /api/projects-summary/:projectName/latest-update", error);
      return sendError(res, serverError("Failed to save latest update"));
    }
  });

  app.patch("/api/projects-summary/:projectInfoId/escalation", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.projectInfoId as string);
      const schema = z.object({
        escalationLevel: z.enum(["None", "Low", "Medium", "High", "Highest"]).nullable(),
      });
      const { escalationLevel } = schema.parse(req.body);
      const result = await storage.updateProjectInfoById(id, { escalationLevel });

      if (result) {
      }

      logAuditFromReq(req, { entityType: "project_info", action: "escalation_update", entityId: String(id), changesJson: { description: "Escalation level updated", escalationLevel } });
      if (result) {
        const escalationKey = result.updatedAt ? new Date(result.updatedAt).getTime() : Date.now();
        await createProjectEvent({
          projectId: result.id,
          eventType: "project.escalation_changed",
          sourceEntityType: "project_info",
          sourceEntityId: String(result.id),
          summary: `Escalation changed to ${escalationLevel || "None"}`,
          details: { escalationLevel: escalationLevel || null },
          idempotencyKey: `escalation:${result.id}:${escalationKey}:${escalationLevel || "none"}`,
          ...actorFromReq(req),
        });
      }
      res.json(result);
    } catch (error) {
      logApiError("PATCH /api/projects-summary/:projectInfoId/escalation", error);
      return sendError(res, serverError("Failed to update escalation level"));
    }
  });

  app.post("/api/tracker-monthly", requireAuth, requireTrackerPermission("edit"), async (req, res) => {
    try {
      const { trackerType, monthKey, realised, outstanding, budget } = req.body;
      if (!trackerType || !monthKey) {
        return res.status(400).json({ error: "trackerType and monthKey required" });
      }
      const result = await storage.upsertTrackerMonthlyManual({
        trackerType,
        monthKey,
        realised: realised != null ? String(realised) : null,
        outstanding: outstanding != null ? String(outstanding) : null,
        budget: budget != null ? String(budget) : null,
      });
      logAuditFromReq(req, { entityType: "tracker_monthly", action: "update", entityId: `${trackerType}|${monthKey}`, changesJson: { description: "Tracker monthly entry updated", trackerType, monthKey, realised, outstanding, budget } });
      res.json(result);
    } catch (error) {
      console.error("Tracker monthly save error:", error);
      res.status(500).json({ error: "Failed to save tracker entry", message: "Failed to save tracker entry" });
    }
  });

  app.get("/api/tracker-monthly/:type", requireAuth, requireTrackerPermission("view"), async (req, res) => {
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

  // REMOVED: /api/rev-tracker duplicate (was requireAuth + requireAdmin).
  // The legacy /api/rev-tracker route is now handled exclusively in finance-routes.ts
  // with correct auth (requirePermission("revenue_tracker", "view")) and deprecation logging.
  // Canonical route: /api/revenue-tracker (finance-routes.ts)

  // ==================== COS TRACKER API ====================

  app.get("/api/cos-tracker", requireAuth, async (req, res) => {
    try {
      const [legacyExpenses, manualEntries, legacyRawInflows, allTaskLinks, allOpTasks, allPlans] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getTrackerMonthlyManual('COS'),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedData = await getMergedExpensesAndInflows(
        legacyExpenses,
        legacyRawInflows
      );
      const allProgramExpenses = mergedData.expenses;
      const allInflows = resolveInflowEffectiveDates(mergedData.inflows, allTaskLinks, allOpTasks, allPlans);

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
      const _nowR = new Date();
      const _currentMK = `${_nowR.getFullYear()}-${String(_nowR.getMonth() + 1).padStart(2, '0')}`;

      for (const exp of allProgramExpenses) {
        if (exp.rowType !== 'item') continue;
        const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
        if (isNaN(amount) || amount === 0) continue;

        const dateSource = (
          exp.expenseInvoicedDate
          || (exp as any).forecastPaymentDate
          || (exp as any).computedForecastPaymentDate
          || exp.expensePaymentDate
          || (exp as any).startDate
          || null
        ) as string | null;
        if (!dateSource) continue;
        const dateMatch = String(dateSource).match(/^(\d{4})-(\d{2})/);
        if (!dateMatch) continue;
        const monthKey = `${dateMatch[1]}-${dateMatch[2]}`;

        const pName = (exp.projectName || '').replace(/_Tracker$/i, '');

        if (!cosByMonth.has(monthKey)) {
          cosByMonth.set(monthKey, { total: 0, projects: new Map() });
        }
        const cosBucket = cosByMonth.get(monthKey)!;
        cosBucket.total += amount;
        cosBucket.projects.set(pName, (cosBucket.projects.get(pName) || 0) + amount);

        const isRealised = isCosRealisedCheck(exp) && monthKey <= _currentMK;

        if (isRealised) {
          if (!realisedByMonth.has(monthKey)) {
            realisedByMonth.set(monthKey, { total: 0, projects: new Map() });
          }
          const realBucket = realisedByMonth.get(monthKey)!;
          realBucket.total += amount;
          realBucket.projects.set(pName, (realBucket.projects.get(pName) || 0) + amount);
        }
      }

      const months: any[] = [];
      const startMonth = new Date(Date.UTC(2025, 8, 1));

      let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0, ytdRevRealised = 0;
      const now = new Date();
      const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

      function mapToArray(m: Map<string, number>): { projectName: string; value: number }[] {
        const arr: { projectName: string; value: number }[] = [];
        m.forEach((v, k) => arr.push({ projectName: k, value: v }));
        return arr.sort((a, b) => b.value - a.value);
      }

      for (let i = 0; i < 12; i++) {
        const monthDate = new Date(startMonth);
        monthDate.setUTCMonth(monthDate.getUTCMonth() + i);
        const yr = monthDate.getUTCFullYear();
        const mo = monthDate.getUTCMonth();
        const monthKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;

        const bucket = cosByMonth.get(monthKey);
        const totalCOS = bucket?.total ?? 0;

        const realisedBucket = realisedByMonth.get(monthKey);
        const realisedCOS = Math.min(realisedBucket?.total ?? 0, totalCOS);
        const unrealisedCOS = Math.max(0, totalCOS - realisedCOS);

        const manual = manualMap.get(monthKey);
        const budget = manual?.budget ? parseFloat(manual.budget) : (STATIC_COS_BUDGET_FY26[monthKey] ?? 0);

        const variance = totalCOS - budget;
        const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;

        const revRealised = revByMonth.get(monthKey) ?? 0;
        if (monthKey <= currentMonthKey) {
          ytdCOS += totalCOS;
          ytdRealised += realisedCOS;
          ytdBudget += budget;
          ytdRevRealised += revRealised;
        }
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
          cosProjects: mapToArray(bucket?.projects ?? new Map()),
          realisedProjects: mapToArray(realisedBucket?.projects ?? new Map()),
          unrealisedProjects: (() => {
            const cosPs = bucket?.projects ?? new Map<string, number>();
            const realPs = realisedBucket?.projects ?? new Map<string, number>();
            const unrealMap = new Map<string, number>();
            cosPs.forEach((v, k) => {
              const diff = v - (realPs.get(k) || 0);
              if (diff !== 0) unrealMap.set(k, diff);
            });
            return mapToArray(unrealMap);
          })(),
        });
      }

      res.json(months);
    } catch (error) {
      console.error("COS tracker error:", error);
      res.status(500).json({ error: "Failed to fetch COS tracker data", message: "Failed to fetch COS tracker data" });
    }
  });

  app.get("/api/cos-tracker/month-detail", requireAuth, async (req, res) => {
    try {
      const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
      if (!monthKey) return res.status(400).json({ error: "monthKey required" });

      const match = monthKey.match(/^(\d{4})-(\d{2})$/);
      if (!match) return res.status(400).json({ error: "Invalid monthKey format" });

      const legacyExp = await storage.getAllProgramExpenses();
      const { expenses: allExpenses } = await getMergedExpensesAndInflows(
        legacyExp, []
      );

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

        const _nR = new Date();
        const _cMK = `${_nR.getFullYear()}-${String(_nR.getMonth() + 1).padStart(2, '0')}`;
        const _isFuture = itemMonthKey ? itemMonthKey > _cMK : false;

        const isRealised = isCosRealisedCheck(exp) && !_isFuture;

        // COS state is purely invoice-date driven (not payment date)
        let cosState = 'Planned';
        if (isRealised) {
          cosState = 'COS Realised';
        } else if (exp.expensePoNumber || (exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim())) {
          cosState = 'Committed';
        }

        // Cashflow payment status (4-state model)
        const _hasInv = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
        const _hasPayD = !!(payDate && String(payDate).trim());
        const _payDBlack = _hasPayD && isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);
        let paymentStatus = 'Planned';
        if (_payDBlack && _hasInv) {
          paymentStatus = 'Out of Bank';
        } else if (_payDBlack && !_hasInv) {
          paymentStatus = 'Risk';
        } else if (_hasPayD && !_payDBlack && _hasInv) {
          paymentStatus = 'Outstanding';
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
          invoiceDateConfirmed: isDateConfirmedCheck(exp.invoiceDateConfirmed, exp.invoiceDateFontColor),
          paymentDate: payDate,
          paymentDateConfirmed: isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor),
          supplier: exp.supplierName || null,
          isRealised,
          realisedMonth,
          cosState,
          paymentStatus,
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

  app.patch("/api/cos-tracker/toggle-realised/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid expense id" });

      const { realised } = req.body as { realised: boolean };
      if (typeof realised !== 'boolean') return res.status(400).json({ error: "realised (boolean) required" });

      const allExpenses = await storage.getAllProgramExpenses();
      const expense = allExpenses.find(e => e.id === id);
      if (!expense) return res.status(404).json({ error: "Expense not found", message: "This expense item could not be found. It may have been removed during a re-import. Try refreshing the page." });

      if (realised && !expense.expenseInvoiceNumber) {
        return res.status(400).json({ error: "Cannot mark as realised without an invoice number" });
      }

      await storage.updateProgramExpenseFields(id, {
        invoiceDateConfirmed: realised,
      });

      const updatedExpenses = await storage.getAllProgramExpenses();
      const updatedExpense = updatedExpenses.find(e => e.id === id);
      if (updatedExpense) {
        const newState = classifyExpenseState(updatedExpense as any);
        await storage.updateProgramExpenseFields(id, {
          computedState: newState,
        });
      }

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "cos_realisation",
          entityId: `expense_${id}`,
          projectName: expense.projectName,
          action: "COS_REALISATION_TOGGLE",
          summary: `${realised ? 'Marked' : 'Unmarked'} expense ${id} as realised (${expense.expenseLineItem || expense.expenseCategory})`,
          oldRecord: { invoiceDateConfirmed: !realised },
          newRecord: { invoiceDateConfirmed: realised },
        });
      } catch (auditErr: any) {
        console.warn("[audit] COS realisation toggle audit failed:", auditErr.message);
      }

      // Record manual edit flag for import conflict detection
      recordManualEditFlag({
        entityType: "program_expense",
        entityId: id,
        fieldName: "invoiceDateConfirmed",
        editedByUserId: req.user?.id,
        editedByName: (req as any).user?.name,
      });

      logAuditFromReq(req, { entityType: "cos_realisation", action: "toggle", entityId: String(id), projectName: expense.projectName, changesJson: { description: `${realised ? 'Marked' : 'Unmarked'} as COS realised`, expenseId: id, realised } });
      res.json({ success: true, id, realised });
    } catch (error) {
      console.error("Toggle realised error:", error);
      res.status(500).json({ error: "Failed to toggle realised status" });
    }
  });

  // ==================== REALISATION KPIs (Weekly / Monthly / Yearly) ====================

  app.get("/api/realisation-kpis", requireAuth, async (req, res) => {
    try {
      const legacyExpenses = await storage.getAllProgramExpenses();
      const { expenses: allExpenses } = await getMergedExpensesAndInflows(
        legacyExpenses, []
      );

      const now = new Date();
      const currentMK = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // FY runs Sep–Aug
      const fyStartYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const fyStart = new Date(Date.UTC(fyStartYear, 8, 1)); // Sep 1
      const fyEnd = new Date(Date.UTC(fyStartYear + 1, 7, 31)); // Aug 31

      // Week boundaries (Monday-based)
      function getMonday(d: Date): Date {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const m = new Date(d); m.setDate(diff); m.setHours(0,0,0,0); return m;
      }
      function getSunday(mon: Date): Date {
        const s = new Date(mon); s.setDate(mon.getDate() + 6); return s;
      }
      function toStr(d: Date): string { return d.toISOString().split('T')[0]; }

      const thisWeekMon = getMonday(new Date(now));
      const thisWeekSun = getSunday(thisWeekMon);
      const lastWeekMon = new Date(thisWeekMon); lastWeekMon.setDate(lastWeekMon.getDate() - 7);
      const lastWeekSun = getSunday(lastWeekMon);

      // Month boundaries
      const thisMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      const thisMonthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
      const lastMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
      const lastMonthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));

      interface PeriodBucket {
        total: number;
        realised: number;
        unrealised: number;
        lineCount: number;
        realisedCount: number;
        byProject: Map<string, { total: number; realised: number }>;
      }
      function emptyBucket(): PeriodBucket {
        return { total: 0, realised: 0, unrealised: 0, lineCount: 0, realisedCount: 0, byProject: new Map() };
      }

      // COS monthly series (for sparklines)
      const cosMonthly = new Map<string, { total: number; realised: number }>();
      // Cashflow monthly series
      const cfMonthly = new Map<string, { total: number; realised: number }>();

      // Period buckets
      const cosThisWeek = emptyBucket(), cosLastWeek = emptyBucket();
      const cosThisMonth = emptyBucket(), cosLastMonth = emptyBucket();
      const cosYTD = emptyBucket();
      const cfThisWeek = emptyBucket(), cfLastWeek = emptyBucket();
      const cfThisMonth = emptyBucket(), cfLastMonth = emptyBucket();
      const cfYTD = emptyBucket();

      function inRange(dateStr: string | null, start: Date, end: Date): boolean {
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        d.setHours(0,0,0,0);
        return d >= start && d <= end;
      }

      function addToBucket(bucket: PeriodBucket, amount: number, isRealised: boolean, projectName: string) {
        bucket.total += amount;
        bucket.lineCount++;
        if (isRealised) { bucket.realised += amount; bucket.realisedCount++; }
        else { bucket.unrealised += amount; }
        if (!bucket.byProject.has(projectName)) bucket.byProject.set(projectName, { total: 0, realised: 0 });
        const p = bucket.byProject.get(projectName)!;
        p.total += amount;
        if (isRealised) p.realised += amount;
      }

      for (const exp of allExpenses) {
        if (exp.rowType !== 'item') continue;
        const amount = exp.expenseActualTotal ? parseFloat(exp.expenseActualTotal as string) : 0;
        if (isNaN(amount) || amount === 0) continue;
        const pName = (exp.projectName || '').replace(/_Tracker$/i, '');

        // COS: uses invoice date for bucketing
        const invDate = exp.expenseInvoicedDate as string | null;
        if (invDate) {
          const invDateMatch = invDate.match(/^(\d{4})-(\d{2})/);
          if (invDateMatch) {
            const mk = `${invDateMatch[1]}-${invDateMatch[2]}`;
            const isCosReal = isCosRealisedCheck(exp) && mk <= currentMK;

            // Monthly series
            if (!cosMonthly.has(mk)) cosMonthly.set(mk, { total: 0, realised: 0 });
            const cm = cosMonthly.get(mk)!;
            cm.total += amount;
            if (isCosReal) cm.realised += amount;

            // Weekly buckets
            if (inRange(invDate, thisWeekMon, thisWeekSun)) addToBucket(cosThisWeek, amount, isCosReal, pName);
            if (inRange(invDate, lastWeekMon, lastWeekSun)) addToBucket(cosLastWeek, amount, isCosReal, pName);

            // Monthly buckets
            if (inRange(invDate, thisMonthStart, thisMonthEnd)) addToBucket(cosThisMonth, amount, isCosReal, pName);
            if (inRange(invDate, lastMonthStart, lastMonthEnd)) addToBucket(cosLastMonth, amount, isCosReal, pName);

            // YTD (within FY)
            if (inRange(invDate, fyStart, fyEnd)) addToBucket(cosYTD, amount, isCosReal, pName);
          }
        }

        // Cashflow: uses payment date for bucketing
        const payDate = exp.expensePaymentDate as string | null;
        if (payDate) {
          const payDateMatch = payDate.match(/^(\d{4})-(\d{2})/);
          if (payDateMatch) {
            const mk = `${payDateMatch[1]}-${payDateMatch[2]}`;
            const isCfReal = isCashflowConfirmedCheck(exp) && mk <= currentMK;

            // Monthly series
            if (!cfMonthly.has(mk)) cfMonthly.set(mk, { total: 0, realised: 0 });
            const cfm = cfMonthly.get(mk)!;
            cfm.total += amount;
            if (isCfReal) cfm.realised += amount;

            // Weekly buckets
            if (inRange(payDate, thisWeekMon, thisWeekSun)) addToBucket(cfThisWeek, amount, isCfReal, pName);
            if (inRange(payDate, lastWeekMon, lastWeekSun)) addToBucket(cfLastWeek, amount, isCfReal, pName);

            // Monthly buckets
            if (inRange(payDate, thisMonthStart, thisMonthEnd)) addToBucket(cfThisMonth, amount, isCfReal, pName);
            if (inRange(payDate, lastMonthStart, lastMonthEnd)) addToBucket(cfLastMonth, amount, isCfReal, pName);

            // YTD
            if (inRange(payDate, fyStart, fyEnd)) addToBucket(cfYTD, amount, isCfReal, pName);
          }
        }
      }

      function serializeBucket(bucket: PeriodBucket) {
        const projects: { projectName: string; total: number; realised: number; unrealised: number }[] = [];
        bucket.byProject.forEach((v, k) => {
          projects.push({ projectName: k, total: v.total, realised: v.realised, unrealised: v.total - v.realised });
        });
        projects.sort((a, b) => b.total - a.total);
        return {
          total: bucket.total,
          realised: bucket.realised,
          unrealised: bucket.unrealised,
          realisedPct: bucket.total > 0 ? Number(((bucket.realised / bucket.total) * 100).toFixed(1)) : 0,
          lineCount: bucket.lineCount,
          realisedCount: bucket.realisedCount,
          projects,
        };
      }

      // Build monthly sparkline series (FY months only)
      function buildSeries(monthlyMap: Map<string, { total: number; realised: number }>) {
        const series: { monthKey: string; label: string; total: number; realised: number; unrealised: number; realisedPct: number }[] = [];
        for (let i = 0; i < 12; i++) {
          const d = new Date(Date.UTC(fyStartYear, 8 + i, 1));
          const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          const data = monthlyMap.get(mk);
          const total = data?.total ?? 0;
          const realised = data?.realised ?? 0;
          series.push({
            monthKey: mk,
            label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
            total, realised,
            unrealised: total - realised,
            realisedPct: total > 0 ? Number(((realised / total) * 100).toFixed(1)) : 0,
          });
        }
        return series;
      }

      // Budget variance for COS YTD
      let ytdBudget = 0;
      for (let i = 0; i < 12; i++) {
        const d = new Date(Date.UTC(fyStartYear, 8 + i, 1));
        const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (mk <= currentMK) ytdBudget += STATIC_COS_BUDGET_FY26[mk] ?? 0;
      }

      res.json({
        asOf: now.toISOString(),
        fyLabel: `FY${fyStartYear + 1}`,
        fyStart: toStr(fyStart),
        fyEnd: toStr(fyEnd),
        cos: {
          thisWeek: serializeBucket(cosThisWeek),
          lastWeek: serializeBucket(cosLastWeek),
          thisMonth: serializeBucket(cosThisMonth),
          lastMonth: serializeBucket(cosLastMonth),
          ytd: { ...serializeBucket(cosYTD), budget: ytdBudget, variance: cosYTD.total - ytdBudget, variancePct: ytdBudget > 0 ? Number(((cosYTD.total - ytdBudget) / ytdBudget * 100).toFixed(1)) : 0 },
          monthlySeries: buildSeries(cosMonthly),
        },
        cashflow: {
          thisWeek: serializeBucket(cfThisWeek),
          lastWeek: serializeBucket(cfLastWeek),
          thisMonth: serializeBucket(cfThisMonth),
          lastMonth: serializeBucket(cfLastMonth),
          ytd: serializeBucket(cfYTD),
          monthlySeries: buildSeries(cfMonthly),
        },
      });
    } catch (error) {
      console.error("Realisation KPIs error:", error);
      res.status(500).json({ error: "Failed to fetch realisation KPIs" });
    }
  });

  // ==================== UPCOMING EVENTS (Next 5 working days) ====================

  app.get("/api/upcoming-events", requireAuth, async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const workDays: string[] = [];
      let d = new Date(today);
      while (workDays.length < 5) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) workDays.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
      const rangeStart = workDays[0];
      const rangeEnd = workDays[workDays.length - 1];

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

          const dateVal = m.mode === "start"
            ? (task.actualStart || "")
            : (task.actualEnd || "");
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
      }).from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo));

      for (const r of inflowRows) {
        if (r.paidDate) continue;
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
        amountExVat: normalizedCostLines.amountExVat,
        description: normalizedCostLines.description,
        counterpartyName: normalizedCostLines.counterpartyName,
        paidDate: normalizedCostLines.paidDate,
      }).from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo));

      for (const c of outflowRows) {
        if (c.paidDate) continue;
        const dt = (c.invoiceDate || "").slice(0, 10);
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
      }).from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo));

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
      }).from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo));

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

  // Dashboard routes extracted to ./routes/dashboard-routes.ts
  registerDashboardRoutes(app);


  // ==================== PROJECTS ROUTES ====================

  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      // Strip internal fields before responding
      const shaped = projects.map(({ sourceFile, ...rest }: any) => rest);
      res.json(shaped);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch projects", message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid project ID", message: "Project ID must be a number" });
      }
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found", message: "Project not found" });
      }
      // Strip internal fields before responding
      const { sourceFile, ...shaped } = project as any;
      res.json(shaped);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project", message: "Failed to fetch project" });
    }
  });

  // ==================== TASKS ROUTES ====================

  app.get("/api/tasks", requireAuth, async (req, res) => {
    try {
      // Strip internal fields from task responses
      const stripTask = ({ sourceSheet, rowLocator, ...rest }: any) => rest;

      const { projectId } = req.query;
      if (projectId && typeof projectId === 'string') {
        const tasks = await storage.getTasksByProject(parseInt(projectId));
        return res.json(tasks.map(stripTask));
      }
      const tasks = await storage.getAllTasks();

      const user = (req as any).user;
      const role = user?.role || "";
      const FULL_ACCESS_ROLES = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "ENGINEERING_MANAGER", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER"];
      if (FULL_ACCESS_ROLES.includes(role)) {
        return res.json(tasks.map(stripTask));
      }

      const userId = user?.id || user?.userId;
      const userName = (user?.name || "").toLowerCase();
      const scopedTasks = tasks.filter((t: any) => {
        if (t.ownerUserId === userId || t.createdBy === userId) return true;
        const assignees = (t.assignees || "").toLowerCase();
        if (userName && assignees.includes(userName)) return true;
        const assigneeIds = t.assigneeUserIds || [];
        if (Array.isArray(assigneeIds) && assigneeIds.includes(userId)) return true;
        return false;
      });
      res.json(scopedTasks.map(stripTask));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks", message: "Failed to fetch tasks" });
    }
  });

  // ==================== FILE UPLOAD ROUTE ====================

  // Accept multiple field names: files, file, tracker, trackers
  const multiUpload = upload.fields([
    { name: 'files', maxCount: 20 },
    { name: 'file', maxCount: 20 },
    { name: 'tracker', maxCount: 20 },
    { name: 'trackers', maxCount: 20 }
  ]);

  app.post("/api/upload", requireAuth, multiUpload, async (req, res) => {
    try {
      // Normalize files from multiple possible field names
      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      let files: Express.Multer.File[] = [];
      
      if (filesObj) {
        if (filesObj.files) files.push(...filesObj.files);
        if (filesObj.file) files.push(...filesObj.file);
        if (filesObj.tracker) files.push(...filesObj.tracker);
        if (filesObj.trackers) files.push(...filesObj.trackers);
      }
      
      if (!files || files.length === 0) {
        return res.status(400).json({ 
          error: "no_files", 
          message: "No files received. Expected files/file/tracker field(s)." 
        });
      }

      const results: { 
        file: string; 
        status: string; 
        message?: string; 
        project_name?: string;
        expensesParsed?: number;
        inflowsParsed?: number;
        planParsed?: number;
        infoParsed?: boolean;
        cashflowParsed?: number;
        financeRevenueParsed?: number;
        financeCosParsed?: number;
        warnings?: string[];
        mode?: string;
      }[] = [];

      // Get upload mode and options from form data
      const mode = (req.body?.mode as string) || 'refresh'; // 'create', 'refresh', or 'duplicate'
      const resetOverrides = req.body?.resetOverrides === 'true';

      for (const file of files) {
        try {
          // Read and parse file first (no DB writes yet)
          const fileBuffer = fs.readFileSync(file.path);
          const actualType = await fileTypeFromBuffer(fileBuffer);
          const allowedMime = new Set([
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel.sheet.macroEnabled.12",
            "application/vnd.ms-excel",
          ]);
          if (!actualType || !allowedMime.has(actualType.mime)) {
            throw new Error(`Invalid file signature for ${file.originalname}`);
          }
          const cleanedFilename = file.originalname.replace(/^\d{10,}_/, '');
          const parseResult = await parseTrackerFile(fileBuffer, cleanedFilename);
          
          await applyFontColors(parseResult.expenses, fileBuffer);

          function sanitizeRecord(record: Record<string, any>) {
            for (const key of Object.keys(record)) {
              const val = record[key];
              if (typeof val === 'number' && (isNaN(val) || !isFinite(val))) {
                record[key] = null;
              }
              if (typeof val === 'string' && (val === 'NaN' || val === 'Infinity' || val === '-Infinity')) {
                record[key] = null;
              }
            }
          }
          parseResult.expenses.forEach(sanitizeRecord);
          parseResult.inflows.forEach(sanitizeRecord);
          parseResult.planItems.forEach(sanitizeRecord);
          parseResult.cashflowPoints.forEach(sanitizeRecord);
          parseResult.financeRevenueMonthly.forEach(sanitizeRecord);
          parseResult.financeCosMonthly.forEach(sanitizeRecord);
          if (parseResult.projectInfo) sanitizeRecord(parseResult.projectInfo);
          
          // Handle duplicate mode: append timestamp to make project name unique
          let targetProjectName = parseResult.projectName;
          if (mode === 'duplicate') {
            const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
            targetProjectName = `${parseResult.projectName}_${timestamp}`;
            // Update project info with new name
            if (parseResult.projectInfo) {
              parseResult.projectInfo.projectName = targetProjectName;
            }
            // Update all records with new project name
            parseResult.expenses.forEach(e => e.projectName = targetProjectName);
            parseResult.inflows.forEach(i => i.projectName = targetProjectName);
            parseResult.planItems.forEach(p => p.projectName = targetProjectName);
            parseResult.cashflowPoints.forEach(c => c.projectName = targetProjectName);
            parseResult.financeRevenueMonthly.forEach(r => r.projectName = targetProjectName);
            parseResult.financeCosMonthly.forEach(c => c.projectName = targetProjectName);
          }
          
          // Perform all DB operations in a single transaction to prevent partial updates
          await storage.transaction(async (txStorage) => {
            // For refresh mode or create mode (if project already exists), delete existing data
            if (mode !== 'duplicate') {
              await txStorage.deleteProgramExpensesByProject(targetProjectName);
              await txStorage.deleteProgramInflowsByProject(targetProjectName);
              await txStorage.deleteProjectPlansByProject(targetProjectName);
              await txStorage.deleteCashflowPointsByProject(targetProjectName);
              await txStorage.deleteFinanceRevenueMonthlyByProject(targetProjectName);
              await txStorage.deleteFinanceCosMonthlyByProject(targetProjectName);
              
              // Optionally reset planning overrides
              if (resetOverrides) {
                await txStorage.deletePlanningOverridesByProject(targetProjectName);
              }
            }

            // Insert project info (safeguard: never enable execution from import, map phase→executionPhase)
            if (parseResult.projectInfo) {
              safeguardImportProjectInfo(parseResult.projectInfo);
              await txStorage.upsertProjectInfo(parseResult.projectInfo);
            }

            // Insert expenses
            if (parseResult.expenses.length > 0) {
              await txStorage.createManyProgramExpenses(parseResult.expenses);
            }

            // Insert inflows
            if (parseResult.inflows.length > 0) {
              await txStorage.createManyProgramInflows(parseResult.inflows);
            }

            // Insert plan items
            if (parseResult.planItems.length > 0) {
              await txStorage.createManyProjectPlans(parseResult.planItems);
            }

            // Insert cashflow points
            if (parseResult.cashflowPoints.length > 0) {
              await txStorage.createManyCashflowPoints(parseResult.cashflowPoints);
            }

            // Insert finance revenue monthly
            if (parseResult.financeRevenueMonthly.length > 0) {
              await txStorage.createManyFinanceRevenueMonthly(parseResult.financeRevenueMonthly);
            }

            // Insert finance COS monthly
            if (parseResult.financeCosMonthly.length > 0) {
              await txStorage.createManyFinanceCosMonthly(parseResult.financeCosMonthly);
            }

            // Log upload metadata
            await txStorage.createUpload({
              fileName: file.originalname,
              filePath: file.path, // Store disk path for reprocessing
              uploadedBy: req.user?.id || null,
              recordsProcessed: parseResult.expensesParsed + parseResult.inflowsParsed + parseResult.planParsed + 
                              parseResult.cashflowParsed + parseResult.financeRevenueParsed + parseResult.financeCosParsed,
              validationErrors: parseResult.warnings.length > 0 ? parseResult.warnings.join("; ") : null,
              status: "success"
            });
          });

          results.push({
            file: file.originalname,
            status: "success",
            project_name: targetProjectName,
            expensesParsed: parseResult.expensesParsed,
            inflowsParsed: parseResult.inflowsParsed,
            planParsed: parseResult.planParsed,
            infoParsed: parseResult.infoParsed,
            cashflowParsed: parseResult.cashflowParsed,
            financeRevenueParsed: parseResult.financeRevenueParsed,
            financeCosParsed: parseResult.financeCosParsed,
            warnings: parseResult.warnings,
            mode: mode
          });

          try {
            await createSnapshotFromUpload(fileBuffer, file.originalname, (req.user as any)?.email || "admin");
          } catch (snapErr: any) {
            console.error("[Snapshot] Non-blocking snapshot creation failed:", snapErr.message);
          }

          try {
            const preview = await runSmartImportPreview(fileBuffer, file.originalname);
            const norm = preview.normalization;
            const resolvedProjectName = targetProjectName;
            const [existingProject] = await db.select({ id: projectInfo.id }).from(projectInfo)
              .where(eq(projectInfo.projectName, resolvedProjectName));
            const pId = existingProject?.id || null;

            if (pId) {
              await db.delete(workItems).where(
                and(
                  eq(workItems.projectId, pId),
                  eq(workItems.workstream, 'PM' as any),
                  eq(workItems.source, 'SMART_IMPORT' as any)
                )
              );
            }
            // Temporal: soft-close existing rows instead of hard delete (Prompt 10)
            await softCloseByProjectName(db, "normalized_revenue_lines", resolvedProjectName);
            await softCloseByProjectName(db, "normalized_cost_lines", resolvedProjectName);
            await db.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectName, resolvedProjectName));

            const dummyRun = await db.insert(smartImportRuns).values({
              fileName: file.originalname,
              projectName: resolvedProjectName,
              projectId: pId,
              uploadedBy: req.user?.id || null,
              status: "COMMITTED",
              committedAt: new Date(),
              committedBy: req.user?.id || null,
              summaryJson: {} as any,
            }).returning();
            const importRunId = dummyRun[0].id;

            if (norm.planTasks.length > 0) {
              await db.insert(workItems).values(norm.planTasks.map((t: any, idx: number) => ({
                projectId: pId,
                workstream: 'PM' as any,
                source: 'SMART_IMPORT' as any,
                title: t.taskName,
                wbsCode: t.taskNo || null,
                type: t.phase,
                startDate: t.startDate,
                endDate: t.endDate,
                duration: t.durationDays,
                actualStart: t.actualStartDate || null,
                actualEnd: t.actualEndDate || null,
                actualDuration: t.actualDurationDays || null,
                ownerName: t.owner,
                status: t.status || 'Not Started',
                percentComplete: t.pctComplete,
                description: t.comment,
                sourceSheet: t.sourceSheet,
                sourceRow: t.sourceRow,
                importRunId,
                externalRef: `${resolvedProjectName}::PLAN::${t.taskNo || idx}::${importRunId}`,
              })));
            }
            const uploadTimestamp = new Date();
            if (norm.revenueLines.length > 0) {
              const revVals = norm.revenueLines.map((r: any) => ({
                projectId: pId, projectName: resolvedProjectName,
                description: r.description, milestoneName: r.milestoneName,
                amountExVat: r.amountExVat, vat: r.vat,
                invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate,
                invoiceDateFontColor: r.invoiceDateFontColor,
                invoiceDateConfirmed: r.invoiceDateConfirmed || false,
                expectedPaymentDate: r.expectedPaymentDate, paidDate: r.paidDate,
                paidDateFontColor: r.paidDateFontColor,
                paidDateConfirmed: r.paidDateConfirmed || false,
                inBankDate: r.inBankDate, status: r.status,
                sourceSheet: r.sourceSheet, sourceRow: r.sourceRow, importRunId,
                turnaroundDays: r.turnaroundDays,
              }));
              await db.insert(normalizedRevenueLines).values(addTemporalColumns(revVals, importRunId, uploadTimestamp) as any);
            }
            if (norm.costLines.length > 0) {
              const costVals = norm.costLines.map((c: any) => ({
                projectId: pId, projectName: resolvedProjectName,
                costCategory: c.costCategory, counterpartyName: c.counterpartyName,
                description: c.description, amountExVat: c.amountExVat,
                invoiceNumber: c.invoiceNumber, invoiceDate: c.invoiceDate,
                invoiceDateFontColor: c.invoiceDateFontColor,
                invoiceDateConfirmed: c.invoiceDateConfirmed || false,
                approvedDate: c.approvedDate, paidDate: c.paidDate,
                paidDateFontColor: c.paidDateFontColor,
                paidDateConfirmed: c.paidDateConfirmed || false,
                poNumber: c.poNumber, cosRealised: c.cosRealised || false,
                cashflowConfirmed: c.cashflowConfirmed || false,
                status: c.status, sourceSheet: c.sourceSheet, sourceRow: c.sourceRow,
                importRunId, turnaroundDays: c.turnaroundDays,
              }));
              await db.insert(normalizedCostLines).values(addTemporalColumns(costVals, importRunId, uploadTimestamp) as any);
            }
            if (norm.costedSummary) {
              try {
                const existing = await storage.getProjectRevenueSummary(resolvedProjectName);
                const hasManualOverride = existing && (existing.plannedRevenue || existing.plannedExpenditure);
                if (!hasManualOverride) {
                  await storage.upsertProjectRevenueSummary({
                    projectName: resolvedProjectName,
                    plannedRevenue: norm.costedSummary.plannedRevenue?.toString() ?? null,
                    plannedExpenditure: norm.costedSummary.plannedExpenditure?.toString() ?? null,
                    plannedProfit: norm.costedSummary.plannedProfit?.toString() ?? null,
                    plannedMargin: norm.costedSummary.plannedMargin?.toString() ?? null,
                    actualRevenue: null,
                    actualExpenditure: null,
                    actualProfit: null,
                    actualMargin: null,
                    voPmLimit: null,
                    currentVoTotal: null,
                  });
                  console.log(`[Upload] Stored costed summary for "${resolvedProjectName}": Rev=${norm.costedSummary.plannedRevenue}, Exp=${norm.costedSummary.plannedExpenditure}`);
                } else {
                  console.log(`[Upload] Skipped costed summary for "${resolvedProjectName}" — manual override exists`);
                }
              } catch (summaryErr: any) {
                console.warn("[Upload] Non-blocking costed summary storage failed:", summaryErr.message);
              }
            }
            console.log(`[Upload] Also populated normalized tables for "${resolvedProjectName}" via smart import pipeline`);
          } catch (normErr: any) {
            console.error("[Upload] Non-blocking normalized table population failed:", normErr.message);
          }

        } catch (fileError: any) {
          console.error("File parse/upload error:", fileError);
          const { dbMode } = await import("./db");
          
          results.push({
            file: file.originalname,
            status: "error",
            message: fileError.message || "Failed to process file"
          });

          // Try to log error upload (may fail if DB is unavailable)
          try {
            await storage.createUpload({
              fileName: file.originalname,
              uploadedBy: req.user?.id || null,
              recordsProcessed: 0,
              validationErrors: fileError.message,
              status: "error"
            });
          } catch (logError) {
            console.error("Failed to log upload error:", logError);
          }
        }
      }

      await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: results.every(r => r.status === "success") ? "success" : "partial"
      });

      logAuditFromReq(req, { entityType: "file_upload", action: "create", changesJson: { description: `Uploaded ${files.length} file(s)`, fileCount: files.length, projectNames: results.filter(r => r.project_name).map(r => r.project_name) }, source: "IMPORT" });
      res.json({ 
        message: `Processed ${files.length} file(s)`,
        results 
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      const { dbMode } = await import("./db");
      res.status(500).json({ 
        error: error.message || "Failed to process upload",
        message: error.message || "Failed to process upload",
        code: error.code || 'UPLOAD_ERROR',
        dbMode 
      });
    }
  });

  // ==================== REPROCESS ALL UPLOADS ====================

  app.post("/api/reprocess-all", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Get all uploads with file paths
      const uploads = await storage.getAllUploads();
      const reprocessResults: { fileName: string; status: string; message?: string }[] = [];
      
      // Group by project (use most recent upload per project)
      const projectFiles = new Map<string, { filePath: string; fileName: string }>();
      for (const upload of uploads) {
        if (!upload.filePath) continue;
        
        const projectName = upload.fileName
          .replace(/\.(xlsx|xlsm|xls)$/i, '')
          .replace(/_[Tt]racker\d*$/, '')
          .replace(/_/g, ' ')
          .trim();
        
        // Only keep if this is the most recent or if project not yet seen
        if (!projectFiles.has(projectName)) {
          projectFiles.set(projectName, { filePath: upload.filePath, fileName: upload.fileName });
        }
      }
      
      // Reprocess each project's latest file
      for (const [projectName, fileInfo] of Array.from(projectFiles.entries())) {
        try {
          if (!fs.existsSync(fileInfo.filePath)) {
            reprocessResults.push({
              fileName: fileInfo.fileName,
              status: "error",
              message: "File not found on disk"
            });
            continue;
          }
          
          const fileBuffer = fs.readFileSync(fileInfo.filePath);
          const parseResult = await parseTrackerFile(fileBuffer, fileInfo.fileName);
          
          await applyFontColors(parseResult.expenses, fileBuffer);
          
          // Delete existing data for this project
          await storage.deleteProgramExpensesByProject(parseResult.projectName);
          await storage.deleteProgramInflowsByProject(parseResult.projectName);
          await storage.deleteProjectPlansByProject(parseResult.projectName);
          await storage.deleteCashflowPointsByProject(parseResult.projectName);
          await storage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
          await storage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
          
          // Re-insert all data (safeguard: never enable execution from import)
          if (parseResult.projectInfo) {
            safeguardImportProjectInfo(parseResult.projectInfo);
            await storage.upsertProjectInfo(parseResult.projectInfo);
          }
          if (parseResult.expenses.length > 0) {
            await storage.createManyProgramExpenses(parseResult.expenses);
          }
          if (parseResult.inflows.length > 0) {
            await storage.createManyProgramInflows(parseResult.inflows);
          }
          if (parseResult.planItems.length > 0) {
            await storage.createManyProjectPlans(parseResult.planItems);
          }
          if (parseResult.cashflowPoints.length > 0) {
            await storage.createManyCashflowPoints(parseResult.cashflowPoints);
          }
          if (parseResult.financeRevenueMonthly.length > 0) {
            await storage.createManyFinanceRevenueMonthly(parseResult.financeRevenueMonthly);
          }
          if (parseResult.financeCosMonthly.length > 0) {
            await storage.createManyFinanceCosMonthly(parseResult.financeCosMonthly);
          }
          
          reprocessResults.push({
            fileName: fileInfo.fileName,
            status: "success",
            message: `Reprocessed ${parseResult.cashflowParsed + parseResult.financeRevenueParsed + parseResult.financeCosParsed} cashflow/finance records`
          });
          
        } catch (error: any) {
          reprocessResults.push({
            fileName: fileInfo.fileName,
            status: "error",
            message: error.message || "Reprocessing failed"
          });
        }
      }
      
      await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: reprocessResults.every(r => r.status === "success") ? "success" : "partial"
      });

      logAuditFromReq(req, { entityType: "system", action: "reprocess_all", source: "SYSTEM", changesJson: { projectsProcessed: projectFiles.size, results: reprocessResults.map(r => ({ file: r.fileName, status: r.status })) } });
      
      res.json({
        message: `Reprocessed ${projectFiles.size} project(s)`,
        results: reprocessResults
      });
      
    } catch (error: any) {
      console.error("Reprocess error:", error);
      const { dbMode } = await import("./db");
      res.status(500).json({ 
        error: error.message || "Failed to reprocess files",
        message: error.message || "Failed to reprocess files",
        code: error.code || 'REPROCESS_ERROR',
        dbMode
      });
    }
  });

  // ==================== PROGRAM DATA ROUTES ====================

  app.get("/api/program-expenses", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let expenses;

      if (projectName && typeof projectName === 'string') {
        // RLS: verify user has access to this project by name
        const { resolveProjectScope, isProjectAccessibleByName } = await import("./services/project-access-service");
        const expUser = (req as any).user;
        const expScope = await resolveProjectScope(expUser?.id || 0, expUser?.role || "", expUser?.name || "");
        if (!isProjectAccessibleByName(expScope, projectName)) {
          return res.status(403).json({ error: "FORBIDDEN", message: "You do not have access to this project" });
        }
        expenses = await storage.getProgramExpensesByProject(projectName);

        // Apply overrides if requested
        if (applyOverrides === 'true') {
          // Override data now baked into base rows
        }
      } else {
        expenses = await storage.getAllProgramExpenses();
        // RLS: filter to accessible projects
        const { resolveProjectScope, isProjectAccessibleByName } = await import("./services/project-access-service");
        const expUser = (req as any).user;
        const expScope = await resolveProjectScope(expUser?.id || 0, expUser?.role || "", expUser?.name || "");
        if (expScope.kind === "scoped") {
          expenses = expenses.filter((e: any) => isProjectAccessibleByName(expScope, e.projectName || ""));
        }
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

  // Parameterized route for fetching expenses by project name in URL path
  app.get("/api/program-expenses/:projectName", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.params;
      const { applyOverrides } = req.query;

      // RLS: verify user has access to this project
      const { resolveProjectScope, isProjectAccessibleByName } = await import("./services/project-access-service");
      const expPUser = (req as any).user;
      const expPScope = await resolveProjectScope(expPUser?.id || 0, expPUser?.role || "", expPUser?.name || "");
      if (!isProjectAccessibleByName(expPScope, projectName)) {
        return res.status(403).json({ error: "FORBIDDEN", message: "You do not have access to this project" });
      }

      let expenses = await storage.getProgramExpensesByProject(projectName);

      // Apply overrides if requested
      if (applyOverrides === 'true') {
        // Override data now baked into base rows
      }

      // Sub-project filter (for multi-project/Ad Hoc trackers)
      const subProject = req.query.subProject as string | undefined;
      if (subProject) {
        expenses = expenses.filter((e: any) => e.subProjectName === subProject);
      }

      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch program expenses", message: "Failed to fetch program expenses" });
    }
  });

  app.get("/api/program-inflows", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let inflows;

      if (projectName && typeof projectName === 'string') {
        // RLS: verify user has access to this project by name
        const { resolveProjectScope, isProjectAccessibleByName } = await import("./services/project-access-service");
        const infUser = (req as any).user;
        const infScope = await resolveProjectScope(infUser?.id || 0, infUser?.role || "", infUser?.name || "");
        if (!isProjectAccessibleByName(infScope, projectName)) {
          return res.status(403).json({ error: "FORBIDDEN", message: "You do not have access to this project" });
        }
        inflows = await storage.getProgramInflowsByProject(projectName);

        // Apply overrides if requested
        if (applyOverrides === 'true') {
          // Override data now baked into base rows
        }
      } else {
        inflows = await storage.getAllProgramInflows();
        // RLS: filter to accessible projects
        const { resolveProjectScope, isProjectAccessibleByName } = await import("./services/project-access-service");
        const infUser = (req as any).user;
        const infScope = await resolveProjectScope(infUser?.id || 0, infUser?.role || "", infUser?.name || "");
        if (infScope.kind === "scoped") {
          inflows = inflows.filter((i: any) => isProjectAccessibleByName(infScope, i.projectName || ""));
        }
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

      // Sub-project filter
      const subProjectFilter = req.query.subProject as string | undefined;
      if (subProjectFilter && inflows) {
        inflows = inflows.filter((i: any) => i.subProjectName === subProjectFilter);
      }

      res.json(inflows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch program inflows", message: "Failed to fetch program inflows" });
    }
  });

  app.get("/api/project-plans", requireAuth, async (req, res) => {
    try {
      const { projectName, applyOverrides } = req.query;
      let plans;
      
      if (projectName && typeof projectName === 'string') {
        plans = await storage.getProjectPlansByProject(projectName);
        
        // Apply overrides if requested
        if (applyOverrides === 'true') {
          // Override data now baked into base rows
        }
        return res.json(plans);
      }
      plans = await storage.getAllProjectPlans();
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plans", message: "Failed to fetch project plans" });
    }
  });

  app.get("/api/project-plan/overrides", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.query;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plan overrides", message: "Failed to fetch project plan overrides" });
    }
  });

  app.get("/api/project-plan/:projectName", requireAuth, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const { applyOverrides } = req.query;
      
      let plans = await storage.getProjectPlansByProject(projectName);
      
      // Override data now baked into base rows
      
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plan", message: "Failed to fetch project plan", code: "PROJECT_PLAN_ERROR" });
    }
  });

  app.get("/api/project-info", requireAuth, async (req, res) => {
    try {
      const usePromotedRead = await getFeatureFlag("promoted_core_projects_read");
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      const info = usePromotedRead
        ? await listProjectInfoFromPromotedCoreCompat()
        : await storage.getAllProjectInfo();

      if (compareMode || usePromotedRead) {
        const comparison = await compareCoreProjectsReadiness();
        if (comparison.status !== "ready") {
          console.warn("[promoted-read][projects] mismatch detected", comparison);
        }
        res.setHeader("X-Promoted-Projects-Read", usePromotedRead ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Projects-Comparison-Status", comparison.status);
      }

      res.json(info);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project info", message: "Failed to fetch project info" });
    }
  });

  app.get("/api/project-detail-master", requireAuth, async (req, res) => {
    try {
      const usePromotedRead = await getFeatureFlag("promoted_core_project_detail_read");
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      const detailRows = usePromotedRead
        ? await listProjectDetailFromPromotedCoreCompat()
        : (await storage.getAllProjectInfo()).map((row: any) => ({
            id: row.id,
            projectName: row.projectName,
            phase: row.phase ?? null,
            ragStatus: row.ragStatus ?? null,
            ragComment: row.ragComment ?? null,
            clientId: row.clientId ?? null,
            clientName: null,
            portfolioMembership: [],
            teamMembers: [],
          }));

      if (compareMode || usePromotedRead) {
        const comparison = await compareProjectDetailMasterReadiness();
        if (comparison.status !== "ready") {
          console.warn("[promoted-read][project-detail-master] mismatch detected", comparison);
        }
        res.setHeader("X-Promoted-Project-Detail-Read", usePromotedRead ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Project-Detail-Comparison-Status", comparison.status);
      }

      res.json(detailRows);
    } catch (error) {
      console.error("Project detail master fetch error:", error);
      res.status(500).json({ error: "Failed to fetch project detail master" });
    }
  });

  app.get("/api/admin/work-item-summary-diagnostics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const flags = await getFeatureFlags(["promoted_core_work_item_summary_read"]);
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      if (!flags.promoted_core_work_item_summary_read && !compareMode) {
        return res.status(403).json({
          error: "feature_flag_disabled",
          message: "Work-item summary diagnostics are disabled. Enable promoted_core_work_item_summary_read or use compare mode.",
        });
      }

      const diagnostics = await buildWorkItemSummaryDiagnostics();
      res.setHeader("X-Promoted-Work-Item-Summary-Read", flags.promoted_core_work_item_summary_read ? "enabled" : "disabled");
      res.json(diagnostics);
    } catch (error) {
      console.error("Work-item summary diagnostics error:", error);
      res.status(500).json({ error: "Failed to generate work-item summary diagnostics" });
    }
  });

  app.patch("/api/project-info/:id", requireAuth, requireAdmin, async (req, res) => {
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
        clientId: z.number().nullable().optional(),
        clientLinkReason: z.string().trim().nullable().optional(),
      });

      const parsed = editSchema.parse(req.body);
      const { clientLinkReason, ...projectInfoPatch } = parsed;
      const existing = await storage.getProjectInfoById(id);
      if (!existing) return res.status(404).json({ error: "Project not found" });

      const sourceOfTruth = classifyProjectInfoPayload(projectInfoPatch as Record<string, unknown>);
      const updated = await storage.updateProjectInfoById(id, projectInfoPatch as any);
      if (!updated) return res.status(404).json({ error: "Project not found" });

      if (
        Object.prototype.hasOwnProperty.call(projectInfoPatch, "clientId")
        && existing.clientId !== updated.clientId
        && req.user?.id
      ) {
        try {
          await db.insert(projectClientHistory).values({
            projectId: updated.id,
            oldClientId: existing.clientId ?? null,
            newClientId: updated.clientId ?? null,
            movedByUserId: req.user.id,
            reason: clientLinkReason || "Project client linkage updated",
          });
        } catch (historyError) {
          console.error("[project-info] failed to record client linkage history", historyError);
        }
      }

      const [projectDualWriteEnabled, importsGovernancePreview] = await Promise.all([
        getFeatureFlag("promoted_core_project_master_dual_write"),
        getFeatureFlag("imports_source_update_governance_preview"),
      ]);

      let projectMirror: { attempted: boolean; success: boolean; error: string | null } = { attempted: false, success: false, error: null };
      if (projectDualWriteEnabled) {
        projectMirror.attempted = true;
        try {
          await db.execute(sql`
            INSERT INTO core.projects (
              id, legacy_project_info_id, project_name, client_id, phase, rag_status, execution_gate_status, execution_gate_reason, updated_at, source_table
            ) VALUES (
              ${updated.id}, ${updated.id}, ${updated.projectName}, ${updated.clientId ?? null}, ${updated.phase ?? null}, ${updated.ragStatus ?? null}, ${updated.executionGateStatus ?? null}, ${updated.executionGateReason ?? null}, NOW(), 'public.project_info'
            )
            ON CONFLICT (id) DO UPDATE
            SET
              project_name = EXCLUDED.project_name,
              client_id = EXCLUDED.client_id,
              phase = EXCLUDED.phase,
              rag_status = EXCLUDED.rag_status,
              execution_gate_status = EXCLUDED.execution_gate_status,
              execution_gate_reason = EXCLUDED.execution_gate_reason,
              updated_at = NOW()
          `);
          projectMirror.success = true;
        } catch (mirrorError: any) {
          projectMirror.error = mirrorError?.message || "unknown_error";
          console.error("[dual-write][project-master] promoted mirror write failed", { projectId: updated.id, error: mirrorError });
        }
      }

      let importsGovernancePreviewRecord: { attempted: boolean; requestId: number | null; error: string | null } = { attempted: false, requestId: null, error: null };
      if (importsGovernancePreview && sourceOfTruth.requiresSourceUpdateGovernance) {
        importsGovernancePreviewRecord.attempted = true;
        try {
          const governanceInsert = await db.execute(sql`
            INSERT INTO imports.source_update_requests (
              project_id,
              source_system,
              source_artifact_ref,
              requested_by_user_id,
              status,
              notes
            ) VALUES (
              ${updated.id},
              'project_info_update',
              ${`project_info:${updated.id}`},
              ${req.user?.id ?? null},
              'pending',
              ${'Preview hook only: non-blocking source update request created during project master update.'}
            )
            RETURNING id
          `);
          const requestId = Number((governanceInsert as any)?.rows?.[0]?.id ?? (governanceInsert as any)?.[0]?.id ?? 0);
          if (requestId) {
            importsGovernancePreviewRecord.requestId = requestId;
            await db.execute(sql`
              INSERT INTO imports.source_update_acknowledgements (
                source_update_request_id,
                acknowledged_by_user_id,
                acknowledged_role,
                acknowledgement_status,
                comments
              ) VALUES (
                ${requestId},
                ${req.user?.id ?? null},
                ${req.user?.role || 'SYSTEM_PREVIEW'},
                'preview_logged',
                'Preview acknowledgement captured automatically; enforcement disabled.'
              )
              ON CONFLICT DO NOTHING
            `);
          }
        } catch (previewError: any) {
          importsGovernancePreviewRecord.error = previewError?.message || 'unknown_error';
          console.error('[imports-governance][preview] failed to record preview request', previewError);
        }
      }

      logAuditFromReq(req, {
        entityType: "project_info",
        action: "update",
        entityId: String(id),
        projectName: updated.projectName,
        changesJson: {
          description: "Project info updated",
          ...parsed,
          projectMirror,
          importsGovernancePreview: importsGovernancePreviewRecord,
          sourceOfTruth,
        },
      });
      if (projectMirror.attempted) {
        res.setHeader("X-Promoted-Project-Master-Dual-Write", projectMirror.success ? "mirrored" : "mirror_failed");
      }
      res.json({ ...updated, _promotedMirror: projectMirror, _importsGovernancePreview: importsGovernancePreviewRecord });
    } catch (error) {
      console.error("Project info update error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update project info" });
    }
  });

  // ==================== CLIENTS ROUTES ====================


  app.get("/api/readiness/cutover-post-validation", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [domainRolloutReadiness, cutoverPostValidation] = await Promise.all([
        getDomainRolloutReadinessReport(),
        getCutoverPostValidationReport(),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        domainRolloutReadiness,
        cutoverPostValidation,
      });
    } catch (error) {
      console.error("Cutover post-validation report error:", error);
      res.status(500).json({ error: "Failed to generate cutover post-validation report" });
    }
  });

  app.get("/api/imports/sync-state", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectIdParam = req.query.projectId;
      const projectId = typeof projectIdParam === "string" && projectIdParam.trim().length > 0 ? Number(projectIdParam) : undefined;
      if (projectIdParam !== undefined && (!Number.isFinite(projectId) || (projectId as number) <= 0)) {
        return res.status(400).json({ error: "Invalid projectId query parameter" });
      }

      const rows = await listImportSyncState(projectId);
      res.json({
        generatedAt: new Date().toISOString(),
        rows,
      });
    } catch (error) {
      console.error("Imports sync-state fetch error:", error);
      res.status(500).json({ error: "Failed to fetch imports sync-state" });
    }
  });

  app.get("/api/readiness/core-master-data", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const report = await getCoreMasterDataReadinessReport();
      const [workDiagnostics, importsGovernance, domainRolloutReadiness] = await Promise.all([
        buildWorkItemSummaryDiagnostics(50),
        compareImportsGovernanceReadiness(),
        getDomainRolloutReadinessReport(),
      ]);
      const rolloutFlags = await getFeatureFlags([
        "promoted_core_clients_read",
        "promoted_core_projects_read",
        "promoted_core_portfolios_read",
        "promoted_core_portfolio_assignments_read",
        "promoted_core_project_detail_read",
        "promoted_core_work_item_summary_read",
        "promoted_core_clients_dual_write",
        "promoted_core_project_master_dual_write",
        "imports_source_update_governance_preview",
        "promoted_project_management_read",
        "promoted_project_development_read",
        "promoted_documentation_read",
        "promoted_finance_read",
        "imports_governance_enforcement_preview",
        "promoted_engineering_read",
        "promoted_quality_read",
      ]);
      res.json({
        ...report,
        rolloutFlags,
        writeReadiness: {
          firstCandidates: [
            { domain: "clients", flag: "promoted_core_clients_dual_write", readiness: rolloutFlags.promoted_core_clients_dual_write ? "preview_enabled" : "preview_disabled" },
            { domain: "project_master", flag: "promoted_core_project_master_dual_write", readiness: rolloutFlags.promoted_core_project_master_dual_write ? "preview_enabled" : "preview_disabled" },
          ],
          importsGovernance,
        },
        workItemSummaryDiagnostics: {
          totals: workDiagnostics.totals,
          mismatchCategories: workDiagnostics.mismatchCategories,
          sampleProjectIds: workDiagnostics.sampleProjectIds,
        },
        domainRolloutReadiness,
      });
    } catch (error) {
      console.error("Core master data readiness report error:", error);
      res.status(500).json({ error: "Failed to generate core master data readiness report" });
    }
  });

  app.get("/api/clients", requireAuth, async (req, res) => {
    try {
      const usePromotedRead = await getFeatureFlag("promoted_core_clients_read");
      const compareMode = req.query.compare === "1" || req.query.compare === "true";

      const allClients = usePromotedRead
        ? await listClientsFromPromotedCoreCompat()
        : await db.select().from(clients).orderBy(asc(clients.name));

      if (compareMode || usePromotedRead) {
        const comparison = await compareCoreClientsReadiness();
        if (comparison.status !== "ready") {
          console.warn("[promoted-read][clients] mismatch detected", comparison);
        }
        res.setHeader("X-Promoted-Clients-Read", usePromotedRead ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Clients-Comparison-Status", comparison.status);
      }

      res.json(allClients);
    } catch (error) {
      console.error("Clients fetch error:", error);
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/api/clients", requireAuth, requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        clientId: z.string().optional(),
      });
      const parsed = schema.parse(req.body);
      const maxIdResult = await db.execute(sql`SELECT COALESCE(MAX(CAST(SUBSTRING(client_id FROM 5) AS INTEGER)), 0) as max_num FROM clients WHERE client_id LIKE 'EE-C%'`);
      const nextNum = ((maxIdResult.rows[0] as any)?.max_num || 0) + 1;
      const generatedClientId = parsed.clientId || `EE-C${String(nextNum).padStart(4, '0')}`;
      const [created] = await db.insert(clients).values({
        name: parsed.name,
        clientId: generatedClientId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
      }).returning();

      const dualWriteEnabled = await getFeatureFlag("promoted_core_clients_dual_write");
      let promotedMirror: { attempted: boolean; success: boolean; error: string | null } = { attempted: false, success: false, error: null };
      if (dualWriteEnabled) {
        promotedMirror.attempted = true;
        try {
          await db.execute(sql`
            INSERT INTO core.clients (id, legacy_id, client_code, name, created_by, updated_by, created_at, updated_at, source_table)
            VALUES (${created.id}, ${created.id}, ${generatedClientId}, ${parsed.name}, ${req.user?.id ?? null}, ${req.user?.id ?? null}, NOW(), NOW(), 'public.clients')
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                client_code = EXCLUDED.client_code,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
          `);
          promotedMirror.success = true;
        } catch (mirrorError: any) {
          promotedMirror.error = mirrorError?.message || "unknown_error";
          console.error("[dual-write][clients] promoted mirror write failed", {
            clientId: created.id,
            error: mirrorError,
          });
        }
      }

      logAuditFromReq(req, { entityType: "client", entityId: String(created.id), action: "create", changesJson: { name: parsed.name, clientId: generatedClientId, promotedMirror } });
      if (promotedMirror.attempted) {
        res.setHeader("X-Promoted-Clients-Dual-Write", promotedMirror.success ? "mirrored" : "mirror_failed");
      }
      res.json({ ...created, _promotedMirror: promotedMirror });
    } catch (error) {
      console.error("Client create error:", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  // ==================== FINANCIAL DATA ROUTES ====================

  app.get("/api/cashflow", requireAuth, async (req, res) => {
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
            const d = exp.expensePaymentDate || exp.computedForecastPaymentDate || exp.forecastPaymentDate || exp.expenseInvoicedDate || null;
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

      if (points.length > 50000) {
        console.warn(`[cashflow] Response too large (${points.length} points). Use ?project= to filter.`);
        return res.status(400).json({ 
          error: "Dataset too large", 
          message: `The cashflow data contains ${points.length} data points across all projects. Please select a specific project to view cashflow data, or use the Cashflow 2026 view for portfolio-level analysis.`,
          hint: "Add ?project=ProjectName to filter by project"
        });
      }
      res.json(points);
    } catch (error) {
      console.error("Cashflow API error:", error);
      res.status(500).json({ error: "Failed to fetch cashflow data", message: error instanceof Error ? error.message : "Please try selecting a specific project, or refresh the page. If the problem persists, contact support." });
    }
  });

  // Planning overrides API
  app.get("/api/cashflow/planning-overrides", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.query;
      let overrides;
      
      // Override data now baked into base rows
      overrides = [];

      res.json(overrides);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch planning overrides", message: "Failed to fetch planning overrides" });
    }
  });

  app.post("/api/cashflow/planning-overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }

      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";

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

      const overrideProjectNames = [...new Set(overrides.map((o: any) => o.projectName))];
      for (const pn of overrideProjectNames) {
      }

      logAuditFromReq(req, { entityType: "cashflow_override", action: "create", changesJson: { description: `${overrides.length} planning override(s) saved`, count: overrides.length, projectNames: [...new Set(overrides.map((o: any) => o.projectName))] } });
      res.json({ message: "Planning overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ 
        error: "Failed to save planning overrides", 
        message: error instanceof Error ? error.message : "Failed to save planning overrides" 
      });
    }
  });

  app.delete("/api/cashflow/planning-overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      await storage.deletePlanningOverridesByProject(projectName);

      logAuditFromReq(req, { entityType: "cashflow_override", action: "delete", projectName, changesJson: { description: "All planning overrides deleted for project", projectName } });
      res.json({ message: `Planning overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete planning overrides", message: "Failed to delete planning overrides" });
    }
  });

  app.post("/api/project-plan/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
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

      // Record manual edit flags for import conflict detection
      for (const o of overrides) {
        recordManualEditFlag({
          entityType: "project_plan",
          entityId: o.rowNumber,
          fieldName: o.fieldName,
          editedByUserId: userId,
          editedByName: (req as any).user?.name,
        });
      }

      // Plan edit notifications are tracked via planEditNotifications table (existing mechanism)
      const projectNameForNotif = overrides[0]?.projectName;
      if (projectNameForNotif) {
        const changeDetails = overrides.map((o: any) => ({
          field: o.fieldName,
          newValue: o.overrideValue,
          tasks: [`Row ${o.rowNumber}`],
        }));
        const fieldNames = [...new Set(overrides.map((o: any) => o.fieldName))].join(", ");
        sendPlanChangeNotifications(
          projectNameForNotif,
          req.user?.id,
          `Fields updated: ${fieldNames}.`,
          changeDetails
        );
      }

      logAuditFromReq(req, { entityType: "plan_override", action: "create", projectName: overrides[0]?.projectName, changesJson: { description: `${overrides.length} plan override(s) saved`, count: overrides.length, fields: [...new Set(overrides.map((o: any) => o.fieldName))] } });
      res.json({ message: "Project plan overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ error: "Failed to save project plan overrides", message: error instanceof Error ? error.message : "Failed to save project plan overrides" });
    }
  });

  app.delete("/api/project-plan/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      await storage.deleteProjectPlanOverridesByProject(projectName);

      logAuditFromReq(req, { entityType: "plan_override", action: "delete", projectName, changesJson: { description: "All plan overrides deleted for project", projectName } });
      res.json({ message: `Project plan overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete project plan overrides", message: "Failed to delete project plan overrides" });
    }
  });

  app.post("/api/project-plan/structure", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { operation, projectName: rawProjectName, data } = req.body;
      if (!rawProjectName || !operation) {
        return res.status(400).json({ error: "projectName and operation required" });
      }
      const userId = (req as any).user?.id || null;

      const trackerName = rawProjectName.endsWith("_Tracker") ? rawProjectName : rawProjectName + "_Tracker";
      const plansDirect = await storage.getProjectPlansByProject(rawProjectName);
      const projectName = plansDirect.length > 0 ? rawProjectName : trackerName;

      const notifyStructureChange = (desc: string) => {
        sendPlanChangeNotifications(rawProjectName, userId, desc, [{ operation, tasks: data?.taskRowNumbers || [] }]);
      };

      if (operation === "createMilestone") {
        const { title } = data || {};
        if (!title) return res.status(400).json({ error: "title required" });

        const useCanonical = await isWorkItemsEnabled();
        if (useCanonical) {
          const projectInfoRow = await storage.getProjectInfo(rawProjectName);
          const projectId = projectInfoRow?.id || null;
          if (!projectId) return res.status(400).json({ error: "Project not found" });

          const existingItems = await db.select({ wbsCode: workItems.wbsCode })
            .from(workItems)
            .where(and(
              projectId ? eq(workItems.projectId, projectId) : sql`false`,
              eq(workItems.workstream, "PM"),
              isNull(workItems.deletedAt),
              isNull(workItems.parentId),
            ))
            .orderBy(desc(workItems.id));

          let nextTopLevelNum = 1;
          for (const item of existingItems) {
            if (item.wbsCode) {
              const topLevel = parseInt(item.wbsCode.split('.')[0]);
              if (!isNaN(topLevel) && topLevel >= nextTopLevelNum) {
                nextTopLevelNum = topLevel + 1;
              }
            }
          }
          const newWbsCode = String(nextTopLevelNum);

          const maxSort = await db.select({ maxSort: sql`COALESCE(MAX(sort_order), 0)` })
            .from(workItems)
            .where(and(
              projectId ? eq(workItems.projectId, projectId) : sql`false`,
              isNull(workItems.deletedAt),
            ));
          const nextSortOrder = (Number((maxSort[0] as any)?.maxSort) || 0) + 10;

          const [newMilestone] = await db.insert(workItems).values({
            projectId,
            workstream: "PM",
            source: "UI",
            title,
            status: "Not Started",
            priority: "Normal",
            startDate: null,
            endDate: null,
            duration: 0,
            percentComplete: 0,
            wbsCode: newWbsCode,
            indentLevel: 0,
            parentId: null,
            isMilestone: true,
            createdBy: userId,
            taskMode: "auto",
            sortOrder: nextSortOrder,
          }).returning();

          notifyStructureChange(`New milestone created: "${title}".`);
          return res.json({ message: "Milestone created", workItemId: newMilestone.id, wbsCode: newWbsCode });
        }

        const newRowNumber = -1;

        const milestoneOverrides = [
          { projectName, rowNumber: newRowNumber, fieldName: "highLevelProgramme", overrideValue: title, createdBy: userId },
          { projectName, rowNumber: newRowNumber, fieldName: "indentLevel", overrideValue: "0", createdBy: userId },
          { projectName, rowNumber: newRowNumber, fieldName: "sortOrder", overrideValue: String(newRowNumber), createdBy: userId },
        ];
        await storage.upsertManyProjectPlanOverrides(milestoneOverrides);
        notifyStructureChange(`New milestone created: "${title}".`);
        return res.json({ message: "Milestone created", rowNumber: newRowNumber });
      }

      if (operation === "setParent") {
        const { taskRowNumbers, parentRowNumber } = data || {};
        if (!Array.isArray(taskRowNumbers) || parentRowNumber === undefined) {
          return res.status(400).json({ error: "taskRowNumbers[] and parentRowNumber required" });
        }
        const safeRows = taskRowNumbers.filter((rn: number) => rn !== parentRowNumber);
        if (safeRows.length === 0) {
          return res.status(400).json({ error: "Cannot set a task as its own parent" });
        }
        const overridesToSave: any[] = [];
        for (let i = 0; i < safeRows.length; i++) {
          overridesToSave.push({
            projectName, rowNumber: safeRows[i],
            fieldName: "parentRowNumber", overrideValue: String(parentRowNumber), createdBy: userId,
          });
          overridesToSave.push({
            projectName, rowNumber: safeRows[i],
            fieldName: "indentLevel", overrideValue: "1", createdBy: userId,
          });
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`${taskRowNumbers.length} task(s) grouped under a milestone.`);
        return res.json({ message: `${taskRowNumbers.length} tasks grouped under milestone` });
      }

      if (operation === "removeMilestone") {
        const { taskRowNumbers } = data || {};
        if (!Array.isArray(taskRowNumbers)) {
          return res.status(400).json({ error: "taskRowNumbers[] required" });
        }
        const overridesToSave: any[] = [];
        for (const rn of taskRowNumbers) {
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "parentRowNumber", overrideValue: "", createdBy: userId,
          });
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "indentLevel", overrideValue: "", createdBy: userId,
          });
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`${taskRowNumbers.length} task(s) ungrouped from milestone.`);
        return res.json({ message: `${taskRowNumbers.length} tasks ungrouped` });
      }

      if (operation === "reorder") {
        const { rowNumber, newSortOrder } = data || {};
        if (rowNumber === undefined || newSortOrder === undefined) {
          return res.status(400).json({ error: "rowNumber and newSortOrder required" });
        }
        await storage.upsertManyProjectPlanOverrides([{
          projectName, rowNumber, fieldName: "sortOrder",
          overrideValue: String(newSortOrder), createdBy: userId,
        }]);
        return res.json({ message: "Sort order updated" });
      }

      if (operation === "convertToMilestone") {
        const { milestoneRowNumber, subtaskRowNumbers } = data || {};
        if (milestoneRowNumber === undefined || !Array.isArray(subtaskRowNumbers) || subtaskRowNumbers.length === 0) {
          return res.status(400).json({ error: "milestoneRowNumber and subtaskRowNumbers[] required" });
        }
        const safeSubtasks = subtaskRowNumbers.filter((rn: number) => rn !== milestoneRowNumber);
        if (safeSubtasks.length === 0) {
          return res.status(400).json({ error: "No valid subtasks after excluding milestone" });
        }
        const overridesToSave: any[] = [];
        overridesToSave.push({
          projectName, rowNumber: milestoneRowNumber,
          fieldName: "indentLevel", overrideValue: "0", createdBy: userId,
        });
        overridesToSave.push({
          projectName, rowNumber: milestoneRowNumber,
          fieldName: "parentRowNumber", overrideValue: "", createdBy: userId,
        });
        for (const rn of safeSubtasks) {
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "parentRowNumber", overrideValue: String(milestoneRowNumber), createdBy: userId,
          });
          overridesToSave.push({
            projectName, rowNumber: rn,
            fieldName: "indentLevel", overrideValue: "1", createdBy: userId,
          });
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`Task converted to milestone with ${subtaskRowNumbers.length} subtask(s).`);
        return res.json({ message: `Task converted to milestone with ${subtaskRowNumbers.length} subtasks` });
      }

      if (operation === "deleteMilestone") {
        const { milestoneRowNumber } = data || {};
        if (milestoneRowNumber === undefined || milestoneRowNumber >= 0) {
          return res.status(400).json({ error: "milestoneRowNumber (negative) required" });
        }
        const allOverrides: any[] = [];
        const childOverrides = allOverrides.filter(
          (o: any) => o.fieldName === "parentRowNumber" && o.overrideValue === String(milestoneRowNumber)
        );
        const ungroupOverrides: any[] = [];
        for (const co of childOverrides) {
          ungroupOverrides.push({
            projectName, rowNumber: co.rowNumber,
            fieldName: "parentRowNumber", overrideValue: "", createdBy: userId,
          });
          ungroupOverrides.push({
            projectName, rowNumber: co.rowNumber,
            fieldName: "indentLevel", overrideValue: "", createdBy: userId,
          });
        }
        ungroupOverrides.push({
          projectName, rowNumber: milestoneRowNumber,
          fieldName: "isDeleted", overrideValue: "true", createdBy: userId,
        });
        await storage.upsertManyProjectPlanOverrides(ungroupOverrides);
        notifyStructureChange(`Milestone deleted, ${childOverrides.length} task(s) ungrouped.`);
        return res.json({ message: "Milestone deleted and children ungrouped" });
      }

      if (operation === "setTaskNumber") {
        const { rowNumber, taskNumber } = data || {};
        if (rowNumber === undefined || taskNumber === undefined) {
          return res.status(400).json({ error: "rowNumber and taskNumber required" });
        }
        await storage.upsertManyProjectPlanOverrides([{
          projectName, rowNumber, fieldName: "taskNo",
          overrideValue: String(taskNumber), createdBy: userId,
        }]);
        notifyStructureChange(`Task number manually set to "${taskNumber}".`);
        return res.json({ message: "Task number updated" });
      }

      if (operation === "bulkReorder") {
        const { items } = data || {};
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "items[] with {rowNumber, sortOrder, parentRowNumber?} required" });
        }
        const existingOverrides: any[] = [];
        const indentMap = new Map<number, number>();
        for (const o of existingOverrides) {
          if (o.fieldName === "indentLevel") {
            indentMap.set(o.rowNumber, parseInt(o.overrideValue || "0") || 0);
          }
        }
        const overridesToSave: any[] = [];
        for (const item of items) {
          overridesToSave.push({
            projectName, rowNumber: item.rowNumber,
            fieldName: "sortOrder", overrideValue: String(item.sortOrder), createdBy: userId,
          });
          if (item.parentRowNumber !== undefined) {
            const parentIndent = item.parentRowNumber !== null ? (indentMap.get(item.parentRowNumber) ?? 0) : -1;
            const newIndent = parentIndent + 1;
            overridesToSave.push({
              projectName, rowNumber: item.rowNumber,
              fieldName: "parentRowNumber", overrideValue: item.parentRowNumber !== null ? String(item.parentRowNumber) : "", createdBy: userId,
            });
            overridesToSave.push({
              projectName, rowNumber: item.rowNumber,
              fieldName: "indentLevel", overrideValue: String(Math.max(0, newIndent)), createdBy: userId,
            });
          }
        }
        await storage.upsertManyProjectPlanOverrides(overridesToSave);
        notifyStructureChange(`${items.length} task(s) reordered.`);
        return res.json({ message: `Reordered ${items.length} tasks` });
      }

      if (operation === "renumber") {
        const plansDirect2 = await storage.getProjectPlansByProject(rawProjectName);
        const pName2 = plansDirect2.length > 0 ? rawProjectName : trackerName;
        const rawPlanTasks = plansDirect2.length > 0 ? plansDirect2 : await storage.getProjectPlansByProject(trackerName);
        const planTasks = rawPlanTasks;

        const SECTION_HEADER_TITLES = ["high level programme", "programme", "high level program"];
        const tasks2 = planTasks
          .filter((pt: any) => {
            if (pt.isVirtual) return true;
            const title = (pt.highLevelProgramme || "").trim().toLowerCase();
            return title && !SECTION_HEADER_TITLES.includes(title);
          })
          .map((pt: any) => ({
            rowNumber: pt.rowNumber,
            parentRowNumber: pt.parentRowNumber || null,
            taskNo: pt.taskNo || null,
            sortOrder: pt.sortOrder ?? pt.rowNumber ?? 0,
            isVirtual: pt.isVirtual === true,
          }));

        const hasAnyParentOverrides = tasks2.some(t => t.parentRowNumber != null);

        if (!hasAnyParentOverrides) {
          const taskNoSet = new Set(tasks2.map(t => t.taskNo).filter(Boolean));
          const taskNoToRow = new Map<string, number>();
          for (const t of tasks2) {
            if (t.taskNo) taskNoToRow.set(t.taskNo, t.rowNumber);
          }
          for (const t of tasks2) {
            if (!t.taskNo || !t.taskNo.includes(".")) continue;
            const parts = t.taskNo.split(".");
            parts.pop();
            const parentNo = parts.join(".");
            if (parentNo && taskNoSet.has(parentNo) && taskNoToRow.has(parentNo)) {
              t.parentRowNumber = taskNoToRow.get(parentNo)!;
            }
          }
        }

        const childMap = new Map<number | null, any[]>();
        for (const t of tasks2) {
          const parent = t.parentRowNumber;
          if (!childMap.has(parent)) childMap.set(parent, []);
          childMap.get(parent)!.push(t);
        }
        for (const [, children] of childMap) {
          children.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        }

        const overridesToSave: any[] = [];
        const assignNumbers = (parentRn: number | null, prefix: string) => {
          const children = childMap.get(parentRn) || [];
          children.forEach((child: any, idx: number) => {
            const num = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
            overridesToSave.push({
              projectName: pName2, rowNumber: child.rowNumber,
              fieldName: "taskNo", overrideValue: num, createdBy: userId,
            });
            assignNumbers(child.rowNumber, num);
          });
        };
        assignNumbers(null, "");

        if (overridesToSave.length > 0) {
          await storage.upsertManyProjectPlanOverrides(overridesToSave);
        }
        return res.json({ message: `Renumbered ${overridesToSave.length} tasks` });
      }

      if (operation === "convertToMilestoneWI") {
        const { workItemId, subtaskWorkItemIds } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });

        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });

        try {
          await db.transaction(async (tx) => {
            const repo = {
              getById: async (id: number) => {
                const rows = await tx.select({
                  id: workItems.id,
                  projectId: workItems.projectId,
                  title: workItems.title,
                  isMilestone: workItems.isMilestone,
                  duration: workItems.duration,
                  indentLevel: workItems.indentLevel,
                  parentId: workItems.parentId,
                  deletedAt: workItems.deletedAt,
                  createdAt: workItems.createdAt,
                  updatedAt: workItems.updatedAt,
                }).from(workItems).where(eq(workItems.id, id)).limit(1);
                return rows[0] || null;
              },
              listByIds: async (ids: number[]) => {
                if (!ids.length) return [];
                return tx.select({
                  id: workItems.id,
                  projectId: workItems.projectId,
                  title: workItems.title,
                  isMilestone: workItems.isMilestone,
                  duration: workItems.duration,
                  indentLevel: workItems.indentLevel,
                  parentId: workItems.parentId,
                  deletedAt: workItems.deletedAt,
                  createdAt: workItems.createdAt,
                  updatedAt: workItems.updatedAt,
                }).from(workItems).where(inArray(workItems.id, ids));
              },
              patchById: async (id: number, patch: any) => {
                await tx.update(workItems).set(patch).where(eq(workItems.id, id));
              },
            };

            await convertWorkItemTypeInPlace({
              repo,
              workItemId,
              target: "milestone",
              projectId,
              subtaskWorkItemIds,
            });
          });
        } catch (err: any) {
          if (err instanceof WorkItemConversionError) {
            return res.status(err.status).json({ error: err.message });
          }
          throw err;
        }

        logAuditFromReq(req, {
          entityType: "work_item",
          action: "convert_to_milestone",
          entityId: String(workItemId),
          changesJson: {
            projectName: rawProjectName,
            subtaskWorkItemIds: Array.isArray(subtaskWorkItemIds) ? subtaskWorkItemIds : [],
            conversion: "in_place",
          },
        });

        notifyStructureChange(`Task converted to milestone.`);
        return res.json({ message: "Converted to milestone" });
      }

      if (operation === "convertToTaskWI") {
        const { workItemId } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });

        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });

        try {
          await db.transaction(async (tx) => {
            const repo = {
              getById: async (id: number) => {
                const rows = await tx.select({
                  id: workItems.id,
                  projectId: workItems.projectId,
                  title: workItems.title,
                  isMilestone: workItems.isMilestone,
                  duration: workItems.duration,
                  indentLevel: workItems.indentLevel,
                  parentId: workItems.parentId,
                  deletedAt: workItems.deletedAt,
                  createdAt: workItems.createdAt,
                  updatedAt: workItems.updatedAt,
                }).from(workItems).where(eq(workItems.id, id)).limit(1);
                return rows[0] || null;
              },
              listByIds: async () => [],
              patchById: async (id: number, patch: any) => {
                await tx.update(workItems).set(patch).where(eq(workItems.id, id));
              },
            };

            await convertWorkItemTypeInPlace({
              repo,
              workItemId,
              target: "task",
              projectId,
            });
          });
        } catch (err: any) {
          if (err instanceof WorkItemConversionError) {
            return res.status(err.status).json({ error: err.message });
          }
          throw err;
        }

        logAuditFromReq(req, {
          entityType: "work_item",
          action: "convert_to_task",
          entityId: String(workItemId),
          changesJson: {
            projectName: rawProjectName,
            conversion: "in_place",
          },
        });

        notifyStructureChange(`Milestone converted to regular task.`);
        return res.json({ message: "Converted to task" });
      }

      if (operation === "indentWI") {
        const { workItemId, parentWorkItemId } = data || {};
        if (!workItemId || !parentWorkItemId) return res.status(400).json({ error: "workItemId and parentWorkItemId required" });
        if (workItemId === parentWorkItemId) return res.status(400).json({ error: "Cannot indent a task under itself" });
        const parentItem = await db.select({ indentLevel: workItems.indentLevel }).from(workItems).where(eq(workItems.id, parentWorkItemId));
        const parentIndent = parentItem[0]?.indentLevel ?? 0;
        await db.update(workItems)
          .set({ parentId: parentWorkItemId, indentLevel: parentIndent + 1, updatedAt: new Date() })
          .where(eq(workItems.id, workItemId));
        await db.update(workItems)
          .set({ isMilestone: true, updatedAt: new Date() })
          .where(and(eq(workItems.id, parentWorkItemId), eq(workItems.isMilestone, false)));
        notifyStructureChange(`Task indented under parent.`);
        return res.json({ message: "Task indented" });
      }

      if (operation === "outdentWI") {
        const { workItemId } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });
        await db.update(workItems)
          .set({ parentId: null, indentLevel: 0, updatedAt: new Date() })
          .where(eq(workItems.id, workItemId));
        notifyStructureChange(`Task outdented to top level.`);
        return res.json({ message: "Task outdented" });
      }

      if (operation === "setParentWI") {
        const { workItemIds, parentWorkItemId } = data || {};
        if (!Array.isArray(workItemIds) || parentWorkItemId === undefined) {
          return res.status(400).json({ error: "workItemIds[] and parentWorkItemId required" });
        }
        const safeIds = workItemIds.filter((id: number) => id !== parentWorkItemId);
        if (safeIds.length === 0) return res.status(400).json({ error: "No valid tasks after excluding parent" });
        await db.transaction(async (tx) => {
          const parentItem = await tx.select({ indentLevel: workItems.indentLevel }).from(workItems).where(eq(workItems.id, parentWorkItemId));
          const parentIndent = parentItem[0]?.indentLevel ?? 0;
          for (const wiId of safeIds) {
            await tx.update(workItems)
              .set({ parentId: parentWorkItemId, indentLevel: parentIndent + 1, updatedAt: new Date() })
              .where(eq(workItems.id, wiId));
          }
          await tx.update(workItems)
            .set({ isMilestone: true, updatedAt: new Date() })
            .where(and(eq(workItems.id, parentWorkItemId), eq(workItems.isMilestone, false)));
        });
        notifyStructureChange(`${safeIds.length} task(s) grouped under parent.`);
        return res.json({ message: `${safeIds.length} tasks grouped` });
      }

      if (operation === "removeParentWI") {
        const { workItemIds } = data || {};
        if (!Array.isArray(workItemIds)) return res.status(400).json({ error: "workItemIds[] required" });
        for (const wiId of workItemIds) {
          await db.update(workItems)
            .set({ parentId: null, indentLevel: 0, updatedAt: new Date() })
            .where(eq(workItems.id, wiId));
        }
        notifyStructureChange(`${workItemIds.length} task(s) ungrouped.`);
        return res.json({ message: `${workItemIds.length} tasks ungrouped` });
      }

      if (operation === "reorderWI") {
        const { items } = data || {};
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "items[] with {workItemId, sortOrder} required" });
        }
        for (const item of items) {
          await db.update(workItems)
            .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
            .where(eq(workItems.id, item.workItemId));
        }
        notifyStructureChange(`${items.length} task(s) reordered.`);
        return res.json({ message: `Reordered ${items.length} tasks` });
      }

      if (operation === "renumberWI") {
        const projectInfoRow = await storage.getProjectInfo(rawProjectName);
        const projectId = projectInfoRow?.id || null;
        if (!projectId) return res.status(400).json({ error: "Project not found" });

        const allItems = await db.select({
          id: workItems.id,
          parentId: workItems.parentId,
          wbsCode: workItems.wbsCode,
          sortOrder: workItems.sortOrder,
        }).from(workItems).where(and(
          eq(workItems.projectId, projectId),
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
        )).orderBy(asc(workItems.sortOrder), asc(workItems.id));

        const childMap = new Map<number | null, any[]>();
        for (const item of allItems) {
          const parent = item.parentId || null;
          if (!childMap.has(parent)) childMap.set(parent, []);
          childMap.get(parent)!.push(item);
        }

        const updates: Array<{ id: number; wbsCode: string; indentLevel: number }> = [];
        const assignWbs = (parentId: number | null, prefix: string, depth: number) => {
          const children = childMap.get(parentId) || [];
          children.forEach((child: any, idx: number) => {
            const num = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
            updates.push({ id: child.id, wbsCode: num, indentLevel: depth });
            assignWbs(child.id, num, depth + 1);
          });
        };
        assignWbs(null, "", 0);

        for (const u of updates) {
          await db.update(workItems)
            .set({ wbsCode: u.wbsCode, indentLevel: u.indentLevel, updatedAt: new Date() })
            .where(eq(workItems.id, u.id));
        }
        notifyStructureChange(`WBS renumbered for ${updates.length} tasks.`);
        return res.json({ message: `Renumbered ${updates.length} tasks` });
      }

      if (operation === "deleteMilestoneWI") {
        const { workItemId } = data || {};
        if (!workItemId) return res.status(400).json({ error: "workItemId required" });
        await db.update(workItems)
          .set({ parentId: null, indentLevel: 0, updatedAt: new Date() })
          .where(eq(workItems.parentId, workItemId));
        await db.update(workItems)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(workItems.id, workItemId));
        notifyStructureChange(`Milestone deleted and children ungrouped.`);
        return res.json({ message: "Milestone deleted and children ungrouped" });
      }

      logAuditFromReq(req, { entityType: "plan_structure", action: "update", projectName: rawProjectName, changesJson: { description: `Plan structure operation: ${operation}`, operation, projectName: rawProjectName } });
      return res.status(400).json({ error: `Unknown operation: ${operation}` });
    } catch (error: any) {
      console.error("[plan-structure] Error:", error);
      res.status(500).json({ error: error.message || "Failed to update plan structure" });
    }
  });

  app.post("/api/project-plan/delete-tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, rowNumbers } = req.body;
      if (!projectName || !Array.isArray(rowNumbers) || rowNumbers.length === 0) {
        return res.status(400).json({ error: "projectName and rowNumbers[] required" });
      }
      const userId = (req as any).user?.id || (req as any).jwtPayload?.userId || null;
      const overrides = rowNumbers.map((rn: number) => ({
        projectName,
        rowNumber: rn,
        fieldName: "isDeleted",
        overrideValue: "true",
        createdBy: userId,
      }));
      await storage.upsertManyProjectPlanOverrides(overrides);

      logAuditFromReq(req, { entityType: "plan_task", action: "delete", projectName, changesJson: { description: `${rowNumbers.length} task(s) deleted from plan`, rowNumbers } });
      res.json({ message: `Deleted ${rowNumbers.length} task(s)` });
    } catch (error) {
      console.error("[PlanDelete] Error:", error);
      res.status(500).json({ error: "Failed to delete plan tasks" });
    }
  });

  app.post("/api/work-items/delete", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids[] required" });
      }
      const userId = (req as any).user?.id || (req as any).jwtPayload?.userId || null;
      const now = new Date().toISOString();
      for (const id of ids) {
        await db.execute(sql`UPDATE work_items SET deleted_at = ${now} WHERE id = ${id} AND deleted_at IS NULL`);
      }
      logAuditFromReq(req, { entityType: "work_item", action: "soft_delete", changesJson: { description: `${ids.length} work item(s) soft-deleted`, ids, deletedBy: userId } });
      res.json({ message: `Deleted ${ids.length} work item(s)`, undoAvailable: true, ids });
    } catch (error: any) {
      console.error("[WorkItemsDelete] Error:", error);
      res.status(500).json({ error: "Failed to delete work items" });
    }

  });

  app.post("/api/work-items/restore", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids[] required" });
      }
      for (const id of ids) {
        await db.execute(sql`UPDATE work_items SET deleted_at = NULL WHERE id = ${id}`);
      }
      logAuditFromReq(req, { entityType: "work_item", action: "restore", changesJson: { description: `${ids.length} work item(s) restored`, ids } });
      res.json({ message: `Restored ${ids.length} work item(s)` });
    } catch (error: any) {
      console.error("[WorkItemsRestore] Error:", error);
      res.status(500).json({ error: "Failed to restore work items" });
    }

  });

  app.get("/api/work-items/deleted", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT wi.id, wi.title, wi.status, wi.deleted_at, wi.project_id,
               pi.project_name
        FROM work_items wi
        LEFT JOIN project_info pi ON wi.project_id = pi.id
        WHERE wi.deleted_at IS NOT NULL
        ORDER BY wi.deleted_at DESC
        LIMIT 200
      `);
      const results = Array.isArray(rows) ? rows : (rows.rows || []);
      res.json(results);
    } catch (error: any) {
      console.error("[WorkItemsDeleted] Error:", error);
      res.status(500).json({ error: "Failed to list deleted work items" });
    }
  });

  app.get("/api/work-items/:id/viewers", requireAuth, async (req, res) => {
    try {
      const workItemId = parseInt(req.params.id);
      if (isNaN(workItemId)) return res.status(400).json({ error: "Invalid work item id" });
      const rows = await db.execute(sql`
        SELECT wia.id, wia.work_item_id, wia.user_id, wia.role, wia.created_at,
               u.name as user_name, u.username, u.role as user_role
        FROM work_item_assignments wia
        LEFT JOIN users u ON wia.user_id = u.id
        WHERE wia.work_item_id = ${workItemId} AND wia.role = 'VIEWER'
      `);
      const results = Array.isArray(rows) ? rows : (rows.rows || []);
      res.json(results);
    } catch (error: any) {
      console.error("[WorkItemViewers] Error:", error);
      res.status(500).json({ error: "Failed to list viewers" });
    }
  });

  app.post("/api/work-items/:id/viewers", requireAuth, async (req, res) => {
    try {
      const workItemId = parseInt(req.params.id);
      const { userId: viewerUserId } = req.body;
      if (isNaN(workItemId)) return res.status(400).json({ error: "Invalid work item id" });
      if (!viewerUserId || typeof viewerUserId !== "number") return res.status(400).json({ error: "userId is required" });

      const existing = await db.execute(sql`
        SELECT id FROM work_item_assignments WHERE work_item_id = ${workItemId} AND user_id = ${viewerUserId} AND role = 'VIEWER'
      `).then((r: any) => Array.isArray(r) ? r : (r.rows || []));

      if (existing.length > 0) {
        return res.json({ message: "User is already a viewer", alreadyExists: true });
      }

      await db.execute(sql`
        INSERT INTO work_item_assignments (work_item_id, user_id, role, created_at)
        VALUES (${workItemId}, ${viewerUserId}, 'VIEWER', NOW())
      `);

      logAuditFromReq(req, {
        entityType: "work_item_assignment",
        entityId: String(workItemId),
        action: "add_viewer",
        changesJson: { workItemId, viewerUserId },
      });

      res.json({ success: true, workItemId, viewerUserId });
    } catch (error: any) {
      console.error("[WorkItemViewers] Add error:", error);
      res.status(500).json({ error: "Failed to add viewer" });
    }
  });

  app.delete("/api/work-items/:id/viewers/:userId", requireAuth, async (req, res) => {
    try {
      const workItemId = parseInt(req.params.id);
      const viewerUserId = parseInt(req.params.userId);
      if (isNaN(workItemId) || isNaN(viewerUserId)) return res.status(400).json({ error: "Invalid parameters" });

      await db.execute(sql`
        DELETE FROM work_item_assignments
        WHERE work_item_id = ${workItemId} AND user_id = ${viewerUserId} AND role = 'VIEWER'
      `);

      logAuditFromReq(req, {
        entityType: "work_item_assignment",
        entityId: String(workItemId),
        action: "remove_viewer",
        changesJson: { workItemId, viewerUserId },
      });

      res.json({ success: true, workItemId, viewerUserId });
    } catch (error: any) {
      console.error("[WorkItemViewers] Remove error:", error);
      res.status(500).json({ error: "Failed to remove viewer" });
    }
  });

  // Revenue Tracking Overrides API
  app.get("/api/revenue-tracking/overrides", requireAuth, async (req, res) => {
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

  app.post("/api/revenue-tracking/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
      const userId = req.user?.id;

      // Apply overrides directly to the base table (normalized_revenue_lines)
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName).filter(Boolean))];
      const saved: any[] = [];

      for (const pn of projectNames) {
        const projectOverrides = overrides.filter((o: any) => o.projectName === pn);
        const inflows = await storage.getProgramInflowsByProject(pn);
        const rowMap = new Map(inflows.map((r: any) => [r.rowNumber, r]));

        const rowGroups = new Map<number, Record<string, any>>();
        for (const ov of projectOverrides) {
          const inflow = rowMap.get(ov.rowNumber);
          if (!inflow) continue;
          if (!rowGroups.has(inflow.id)) rowGroups.set(inflow.id, {});
          const fields = rowGroups.get(inflow.id)!;
          const effectiveValue = ov.overrideValue === "__null__" ? null : ov.overrideValue;
          fields[ov.fieldName] = effectiveValue;
        }

        for (const [inflowId, fields] of rowGroups.entries()) {
          if (Object.keys(fields).length > 0) {
            const result = await storage.updateProgramInflowFields(inflowId, fields);
            if (result) saved.push(result);
          }
        }
      }

      try {
        for (const o of overrides) {
          await recordOverride({
            actorUserId: userId,
            actorRole: (req as any).user?.role,
            entityType: "revenue_tracking_override",
            entityId: `${o.projectName}|row${o.rowNumber}|${o.fieldName}`,
            projectName: o.projectName,
            action: "REVENUE_OVERRIDE",
            overrideCategory,
            overrideComment: overrideComment.trim(),
            oldRecord: {},
            newRecord: { [o.fieldName]: o.overrideValue },
          });

          // Record manual edit flag for import conflict detection
          recordManualEditFlag({
            entityType: "revenue_tracking",
            entityId: o.rowNumber,
            fieldName: o.fieldName,
            editedByUserId: userId,
            editedByName: (req as any).user?.name,
          });
        }
      } catch (auditErr: any) {
        console.warn("[audit] Revenue override audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "revenue_tracking_override", action: "create", changesJson: { description: `${overrides.length} revenue tracking override(s) saved`, count: overrides.length, projectNames } });
      res.json({ message: "Revenue tracking overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ error: "Failed to save revenue tracking overrides", message: error instanceof Error ? error.message : "Failed to save revenue tracking overrides" });
    }
  });

  app.delete("/api/revenue-tracking/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      // Override tables collapsed into base tables — no separate overrides to delete
      logAuditFromReq(req, { entityType: "revenue_tracking_override", action: "delete", projectName, changesJson: { description: "All revenue tracking overrides deleted for project", projectName } });
      res.json({ message: `Revenue tracking overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete revenue tracking overrides", message: "Failed to delete revenue tracking overrides" });
    }
  });

  app.get("/api/revenue-tab/:projectName", requireAuth, async (req, res) => {
    try {
      const projectName = req.params.projectName;

      const [rawInflows, overrides, projectInfoList, savedSummary, operationalTasks, planTasks, taskLinks] = await Promise.all([
        storage.getProgramInflowsByProject(projectName),
        Promise.resolve([]),
        storage.getAllProjectInfo(),
        storage.getProjectRevenueSummary(projectName),
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
        storage.getMilestoneTaskLinks(projectName),
      ]);

      const inflows = rawInflows;

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

        if (!isRed && hasInvoice) {
          status = 'inBank';
        } else if (isRed && hasInvoice) {
          status = 'invoiced';
          if (hasPaymentReceived && !paymentConfirmed) {
            flags.push('Payment date present but not confirmed — treated as outstanding');
          } else {
            flags.push('Invoice raised, payment outstanding');
          }
        } else if (isRed && !hasInvoice && isPast) {
          status = 'overdue';
          flags.push('Payment date has passed without invoice');
        } else {
          status = 'planned';
        }

        const hasOverride = overrides.some((o: any) => o.rowNumber === r.rowNumber);

        const link = taskLinks.find((l: any) => l.milestoneRowNumber === r.rowNumber);
        let linkedTask: any = null;
        if (link) {
          if (link.taskId > 0) {
            linkedTask = operationalTasks.find((t: any) => t.id === link.taskId);
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
        };
      });

      milestones.sort((a: any, b: any) => {
        const numA = parseFloat(a.milestoneNo);
        const numB = parseFloat(b.milestoneNo);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        if (!isNaN(numA)) return -1;
        if (!isNaN(numB)) return 1;
        return (a.rowNumber || 0) - (b.rowNumber || 0);
      });

      const totalContract = milestones.reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const invoiced = milestones.filter((m: any) => m.status === 'invoiced' || m.status === 'inBank' || m.status === 'received').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const inBankTotal = milestones.filter((m: any) => m.status === 'inBank').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const pending = milestones.filter((m: any) => m.status === 'planned' || m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const overdueTotal = milestones.filter((m: any) => m.status === 'overdue').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);

      const pInfo = projectInfoList.find((p: any) => p.projectName === projectName);
      const contractValue = pInfo ? parseFloat(String(pInfo.contractValue || '0')) : 0;

      let costedExpenditure = 0;
      let actualExpenditure = 0;
      let allExpenditure = 0;
      try {
        const expenseRows = await storage.getProgramExpensesByProject(projectName);
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
      const actualProfit = actualRevenue - actualExpenditure;
      const actualMargin = actualRevenue > 0 ? actualProfit / actualRevenue : 0;

      const liveRevenue = totalContract;
      const liveExpenditure = allExpenditure;
      const liveProfit = liveRevenue - liveExpenditure;
      const liveMargin = liveRevenue > 0 ? liveProfit / liveRevenue : 0;

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
          },
          planned: {
            revenue: liveRevenue,
            expenditure: liveExpenditure,
            profit: liveProfit,
            margin: liveMargin,
          },
          actual: {
            revenue: actualRevenue,
            expenditure: actualExpenditure,
            profit: actualProfit,
            margin: actualMargin,
          },
          voPmLimit: null,
          currentVoTotal: null,
        },
      });
    } catch (error) {
      console.error("Revenue tab error:", error);
      res.status(500).json({ error: "Failed to fetch revenue tab data" });
    }
  });

  app.post("/api/revenue-tab/:projectName/costed", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const { revenue, expenditure } = req.body;
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
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "revenue_summary",
          entityId: projectName,
          projectName,
          action: "REVENUE_SUMMARY_UPDATED",
          summary: `Updated revenue summary: revenue=${revenue}, expenditure=${expenditure}`,
          oldRecord: {},
          newRecord: { plannedRevenue: revenue, plannedExpenditure: expenditure },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Revenue summary audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "revenue", action: "costed_update", projectName, changesJson: { description: "Revenue costed values updated", revenue, expenditure } });
      res.json(saved);
    } catch (error) {
      console.error("Save costed error:", error);
      res.status(500).json({ error: "Failed to save costed values" });
    }
  });

  app.get("/api/revenue-tab/:projectName/task-alerts", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const [tasks, inflows, taskLinks] = await Promise.all([
        storage.getOperationalTasksByProject(projectName),
        storage.getProgramInflowsByProject(projectName),
        storage.getMilestoneTaskLinks(projectName),
      ]);

      const alerts: any[] = [];
      for (const milestone of inflows) {
        if (!milestone.milestoneNo || !/^\d+$/.test(String(milestone.milestoneNo).trim())) continue;
        const name = (milestone.milestoneName || '').trim();
        if (name === '-') continue;

        const link = taskLinks.find((l: any) => l.milestoneRowNumber === milestone.rowNumber);
        const linkedTask = link ? tasks.find((t: any) => t.id === link.taskId) : null;

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

  // Milestone Task Link API
  app.post("/api/revenue-tab/:projectName/link-task", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const { milestoneRowNumber, taskId } = req.body;
      if (!milestoneRowNumber || !taskId) {
        return res.status(400).json({ error: "milestoneRowNumber and taskId are required" });
      }
      const link = await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, taskId);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "milestone_task_link",
          entityId: `${projectName}|milestone${milestoneRowNumber}`,
          projectName,
          action: "MILESTONE_TASK_LINKED",
          summary: `Linked milestone row ${milestoneRowNumber} to task ${taskId}`,
          oldRecord: {},
          newRecord: { milestoneRowNumber, taskId },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Milestone task link audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "revenue_link", action: "create", projectName, changesJson: { description: "Milestone linked to task", milestoneRowNumber, taskId } });
      res.json(link);
    } catch (error) {
      console.error("Link task error:", error);
      res.status(500).json({ error: "Failed to link task" });
    }
  });

  app.post("/api/revenue-tab/:projectName/date-override", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const { milestoneRowNumber, dateOverride, reason } = req.body;
      if (!milestoneRowNumber || !dateOverride) {
        return res.status(400).json({ error: "milestoneRowNumber and dateOverride are required" });
      }
      const existing = await storage.getMilestoneTaskLinks(projectName);
      const link = existing.find((l: any) => l.milestoneRowNumber === milestoneRowNumber);
      if (link) {
        const updated = await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, link.taskId);
        await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
      } else {
        await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, 0);
        await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
      }

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "milestone_date_override",
          entityId: `${projectName}|milestone${milestoneRowNumber}`,
          projectName,
          action: "MILESTONE_DATE_OVERRIDDEN",
          summary: `Overrode milestone ${milestoneRowNumber} date to ${dateOverride}${reason ? ` (${reason})` : ''}`,
          oldRecord: {},
          newRecord: { milestoneRowNumber, dateOverride, reason },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Milestone date override audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "revenue_date_override", action: "update", projectName, changesJson: { description: "Milestone date overridden", milestoneRowNumber, dateOverride, reason } });
      res.json({ success: true });
    } catch (error) {
      console.error("Date override error:", error);
      res.status(500).json({ error: "Failed to save date override" });
    }
  });

  app.delete("/api/revenue-tab/:projectName/link-task/:milestoneRowNumber", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const milestoneRowNumber = parseInt(req.params.milestoneRowNumber);
      await storage.deleteMilestoneTaskLink(projectName, milestoneRowNumber);

      logAuditFromReq(req, { entityType: "revenue_link", action: "delete", projectName, changesJson: { description: "Milestone task link removed", milestoneRowNumber } });
      res.json({ success: true });
    } catch (error) {
      console.error("Unlink task error:", error);
      res.status(500).json({ error: "Failed to unlink task" });
    }
  });

  // Expenditure Overrides API
  app.get("/api/expenditure/overrides", requireAuth, async (req, res) => {
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

  // Expenditure overrides now handled by finance-routes.ts with approval workflow
  // This legacy route is kept as a fallback redirect to the approval flow
  app.post("/api/expenditure/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
      const userId = req.user?.id;
      const userRole = req.user?.role;

      // Admin users apply overrides directly (this legacy route requires requireAdmin)
      const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
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

      logAuditFromReq(req, { entityType: "expenditure_override", action: "direct_apply", changesJson: { description: `${overrides.length} expenditure override(s) applied directly by admin`, count: overrides.length, projectNames } });
      res.json({ message: "Expenditure overrides applied successfully", count: overrides.length });
    } catch (error) {
      console.error("Failed to submit expenditure overrides for approval:", error);
      res.status(500).json({ error: "Failed to save overrides", message: error instanceof Error ? error.message : "Failed to save overrides" });
    }
  });

  app.delete("/api/expenditure/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      // Override tables collapsed into base tables — no separate overrides to delete
      logAuditFromReq(req, { entityType: "expenditure_override", action: "delete", projectName, changesJson: { description: "All expenditure overrides deleted for project", projectName } });
      res.json({ message: `Expenditure overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete expenditure overrides", message: "Failed to delete expenditure overrides" });
    }
  });

  // ==================== EXPENSE TASK LINKS API ====================

  app.get("/api/expense-task-links/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const links = await storage.getExpenseTaskLinks(req.params.projectName);
      res.json(links);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expense task links" });
    }
  });

  app.post("/api/expense-task-links/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { expenseId, taskId } = req.body;
      if (!expenseId || taskId === undefined) {
        return res.status(400).json({ error: "expenseId and taskId are required" });
      }
      const link = await storage.upsertExpenseTaskLink(req.params.projectName, expenseId, taskId, (req.user as any)?.id);

      logAuditFromReq(req, { entityType: "expense_link", action: "create", projectName: req.params.projectName, changesJson: { description: "Expense linked to task", expenseId, taskId } });
      res.json(link);
    } catch (error) {
      console.error("Link expense task error:", error);
      res.status(500).json({ error: "Failed to link task" });
    }
  });

  app.delete("/api/expense-task-links/:projectName/:expenseId", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteExpenseTaskLink(req.params.projectName, parseInt(req.params.expenseId));

      logAuditFromReq(req, { entityType: "expense_link", action: "delete", projectName: req.params.projectName, changesJson: { description: "Expense task link removed", expenseId: req.params.expenseId } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unlink task" });
    }
  });

  app.post("/api/expense-task-links/:projectName/:expenseId/date-override", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { dateOverride, reason } = req.body;
      const projectName = req.params.projectName;
      const expenseId = parseInt(req.params.expenseId);
      await storage.updateExpenseTaskLinkDateOverride(projectName, expenseId, dateOverride, reason);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_date_override",
          entityId: `${projectName}|expense${expenseId}`,
          projectName,
          action: "EXPENSE_DATE_OVERRIDDEN",
          summary: `Overrode expense ${expenseId} date to ${dateOverride}${reason ? ` (${reason})` : ''}`,
          oldRecord: {},
          newRecord: { expenseId, dateOverride, reason },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Expense date override audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_date_override", action: "update", projectName, changesJson: { description: "Expense date overridden", expenseId, dateOverride, reason } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save date override" });
    }
  });

  // ==================== MANUAL EXPENSE ROWS API ====================

  app.post("/api/expenses/add-line", requireAuth, requireAdmin, async (req, res) => {
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
        isManual: true,
      });

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_line",
          entityId: `${projectName}|row${newExpense.rowNumber}`,
          projectName,
          action: "MANUAL_EXPENSE_ADDED",
          summary: `Added manual expense line: ${expenseLineItem || expenseCategory}`,
          oldRecord: {},
          newRecord: { expenseCategory, expenseLineItem, expenseActualTotal, isManual: true },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Manual expense add audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_line", action: "create", projectName, changesJson: { description: "Manual expense line added", expenseCategory, expenseLineItem } });
      res.json(newExpense);
    } catch (error) {
      console.error("Add expense line error:", error);
      res.status(500).json({ error: "Failed to add expense line item" });
    }
  });

  app.post("/api/expenses/add-category", requireAuth, requireAdmin, async (req, res) => {
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
        isManual: true,
      });

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_category",
          entityId: `${projectName}|row${newCategory.rowNumber}`,
          projectName,
          action: "MANUAL_CATEGORY_ADDED",
          summary: `Added manual expense category: ${categoryName}`,
          oldRecord: {},
          newRecord: { expenseCategory: categoryName, isManual: true },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Manual category add audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_category", action: "create", projectName, changesJson: { description: "Manual expense category added", categoryName } });
      res.json(newCategory);
    } catch (error) {
      console.error("Add category error:", error);
      res.status(500).json({ error: "Failed to add category" });
    }
  });

  app.post("/api/expenses/insert-task-as-line", requireAuth, requireAdmin, async (req, res) => {
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
        isManual: true,
      });
      await storage.upsertExpenseTaskLink(projectName, newExpense.id, taskId, (req.user as any)?.id);

      try {
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expense_line",
          entityId: `${projectName}|row${newExpense.rowNumber}`,
          projectName,
          action: "TASK_INSERTED_AS_EXPENSE",
          summary: `Inserted task "${taskTitle}" as expense line in ${expenseCategory}`,
          oldRecord: {},
          newRecord: { expenseCategory, expenseLineItem: taskTitle, taskId, isManual: true },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Insert task as expense audit failed:", auditErr.message);
      }

      logAuditFromReq(req, { entityType: "expense_line", action: "create", projectName, changesJson: { description: "Task inserted as expense line", taskId, taskTitle, expenseCategory } });
      res.json(newExpense);
    } catch (error) {
      console.error("Insert task as line error:", error);
      res.status(500).json({ error: "Failed to insert task as line item" });
    }
  });

  // ==================== EXPENDITURE BREAKDOWN COMPOSITE API ====================

  app.patch("/api/expenditure/font-color-toggle", requireAuth, async (req, res) => {
    try {
      const { projectName, rowNumber, field, color } = req.body;
      if (!projectName || rowNumber == null || !field || !color) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const confirmedField = field === 'invoiceDateFontColor' ? 'invoiceDateConfirmed'
        : field === 'paymentDateFontColor' ? 'paymentDateConfirmed' : null;
      const isBlack = color === 'black';

      const expenses = await storage.getProgramExpensesByProject(projectName);
      const expense = expenses.find((e: any) => e.rowNumber === rowNumber);
      if (expense) {
        const updateFields: Record<string, any> = { [field]: color };
        if (confirmedField) updateFields[confirmedField] = isBlack;
        await storage.updateProgramExpenseFields(expense.id, updateFields);
      }

      try {
        const oldColor = expense ? (expense as any)[field] || 'unknown' : 'unknown';
        await recordManualEdit({
          actorUserId: req.user?.id,
          actorRole: (req as any).user?.role,
          entityType: "expenditure_font_color",
          entityId: `${projectName}|row${rowNumber}|${field}`,
          projectName,
          action: "FONT_COLOR_TOGGLE",
          summary: `Toggled ${field} from ${oldColor} to ${color} for row ${rowNumber}`,
          oldRecord: { [field]: oldColor },
          newRecord: { [field]: color },
        });
      } catch (auditErr: any) {
        console.warn("[audit] Font color toggle audit failed:", auditErr.message);
      }

      const friendlyField = field === 'paymentDateFontColor' ? 'payment date confirmation' : 'invoice date confirmation';

      logAuditFromReq(req, { entityType: "expenditure_font_color", action: "toggle", projectName, changesJson: { description: `Font color toggled to ${color}`, rowNumber, field, color } });
      res.json({ success: true });
    } catch (error) {
      console.error("Font color toggle error:", error);
      res.status(500).json({ error: "Failed to toggle font color" });
    }
  });

  app.get("/api/expenditure-breakdown/:projectName", requireAuth, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const [rawExpenses, taskLinks, opTasks, planTasks, revSummary] = await Promise.all([
        storage.getProgramExpensesByProject(projectName),
        storage.getExpenseTaskLinks(projectName),
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
        storage.getProjectRevenueSummary(projectName),
      ]);
      const cosOverrides: any[] = [];
      const expenditureOverrides: any[] = [];

      const expenses = rawExpenses;

      const cosOverrideByExpenseId = new Map();
      const cosOverrideByRow = new Map();

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

        const hasInvoice = !!(exp.expenseInvoiceNumber && exp.expenseInvoiceNumber.trim());
        const hasInvDate = !!(exp.expenseInvoicedDate && String(exp.expenseInvoicedDate).trim());
        const invoiceDateBlack = hasInvDate && isDateConfirmedCheck(exp.invoiceDateConfirmed, exp.invoiceDateFontColor);

        let cosStatus: string;
        if (hasInvoice && invoiceDateBlack) {
          cosStatus = 'COS Realised';
        } else if (hasInvoice && hasInvDate && !invoiceDateBlack) {
          cosStatus = 'Deferred';
        } else if (invoiceDateBlack && !hasInvoice) {
          cosStatus = 'Flagged';
        } else {
          cosStatus = 'Planned';
        }

        const effectivePaymentDate = link?.dateOverride || linkedTask?.dueDate || exp.expensePaymentDate || exp.forecastPaymentDate || null;
        const hasPayDate = !!(effectivePaymentDate && String(effectivePaymentDate).trim());
        const isFutureDate = hasPayDate && new Date(effectivePaymentDate!) > new Date();
        const paymentDateBlack = hasPayDate && !isFutureDate && isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);

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

        const cosOverride = cosOverrideByExpenseId.get(exp.id) || cosOverrideByRow.get(`${exp.projectName}:${exp.rowNumber}`);

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
        };
      });

      const categories = [...new Set(expenses.filter((e: any) => e.rowType === 'category').map((e: any) => e.expenseCategory).filter(Boolean))];

      const importedBudgetRaw = enriched.reduce((s: number, e: any) => s + safeNum(e.budgetTotal), 0);
      const costedExpenditure = safeNum(revSummary?.plannedExpenditure);
      if (costedExpenditure > 0 && importedBudgetRaw === 0) {
        const totalAct = enriched.reduce((s: number, e: any) => s + safeNum(e.expenseActualTotal), 0);
        if (totalAct > 0) {
          let allocated = 0;
          for (let i = 0; i < enriched.length; i++) {
            const actual = safeNum(enriched[i].expenseActualTotal);
            if (i === enriched.length - 1) {
              enriched[i].budgetTotal = (costedExpenditure - allocated).toFixed(2);
            } else {
              const share = Math.round((actual / totalAct) * costedExpenditure * 100) / 100;
              enriched[i].budgetTotal = share.toFixed(2);
              allocated += share;
            }
          }
        }
      }

      res.json({ items: enriched, categories });
    } catch (error) {
      console.error("Expenditure breakdown error:", error);
      res.status(500).json({ error: "Failed to fetch expenditure breakdown" });
    }
  });

  // ==================== COS STATUS OVERRIDE API ====================

  app.post("/api/cos-status-override", requireAuth, async (req, res) => {
    try {
      const { expenseId, projectName, rowNumber, originalStatus, overrideStatus, reason } = req.body;
      if (!expenseId || !projectName || !overrideStatus || !reason) {
        return res.status(400).json({ error: "Missing required fields: expenseId, projectName, overrideStatus, reason" });
      }

      const userName = (req.user as any)?.username || (req.user as any)?.fullName || 'Unknown';

      // DEPRECATED: cosStatusOverrides table removed — override data baked into base rows

      // Dual-write: apply COS status override to base program_expense row
      try {
        const userId = (req.user as any)?.id || null;
        await inlineEdit('program_expense', expenseId, { line_status: overrideStatus }, userId);
      } catch (dualWriteErr) {
        console.warn("[COS override] Dual-write to program_expense failed (non-fatal):", dualWriteErr);
      }

      logAuditFromReq(req, { entityType: "cos_override", action: "update", entityId: String(expenseId), projectName, changesJson: { description: "COS status overridden", overrideStatus, originalStatus, reason } });
      res.json({ success: true });
    } catch (error) {
      console.error("COS override error:", error);
      res.status(500).json({ error: "Failed to save COS status override" });
    }
  });

  app.delete("/api/cos-status-override/:expenseId", requireAuth, async (req, res) => {
    try {
      const expenseId = parseInt(req.params.expenseId);

      // Dual-write: revert COS status on base program_expense row
      try {
        const { revertToImported } = await import("./lib/inline-edit-helper");
        await revertToImported('program_expense', expenseId);
      } catch (dualWriteErr) {
        console.warn("[COS override delete] Dual-write revert failed (non-fatal):", dualWriteErr);
      }

      // DEPRECATED: cosStatusOverrides table removed — override data baked into base rows

      logAuditFromReq(req, { entityType: "cos_override", action: "delete", entityId: String(expenseId), changesJson: { description: "COS status override removed" } });
      res.json({ success: true });
    } catch (error) {
      console.error("COS override delete error:", error);
      res.status(500).json({ error: "Failed to remove COS status override" });
    }
  });

  app.get("/api/finance/revenue", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let data;
      
      if (projectName && typeof projectName === 'string') {
        data = await storage.getFinanceRevenueMonthlyByProject(projectName);
        
        // Override data now baked into base rows
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

  app.get("/api/finance/cos", requireAuth, async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let data;
      
      if (projectName && typeof projectName === 'string') {
        data = await storage.getFinanceCosMonthlyByProject(projectName);
        
        // Override data now baked into base rows
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

  // ==================== REFRESH ROUTE ====================

  app.post("/api/refresh", requireAuth, requireAdmin, async (req, res) => {
    try {
      const refreshLog = await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: "success"
      });
      logAuditFromReq(req, { entityType: "system", action: "refresh", source: "SYSTEM" });
      res.json({ message: "Data refresh recorded", refreshedAt: refreshLog.refreshedAt });
    } catch (error) {
      res.status(500).json({ error: "Failed to record refresh", message: "Failed to record refresh", code: "REFRESH_ERROR" });
    }
  });

  app.get("/api/refresh/latest", requireAuth, async (req, res) => {
    try {
      const latest = await storage.getLatestRefresh();
      res.json({ lastRefresh: latest?.refreshedAt?.toISOString() || null });
    } catch (error) {
      res.status(500).json({ error: "Failed to get refresh status", message: "Failed to get refresh status", code: "REFRESH_STATUS_ERROR" });
    }
  });

  // Admin data refresh - re-process all stored tracker files
  app.post("/api/admin/refresh-data", requireAuth, requireAdmin, async (req, res) => {
    const useSSE = req.headers.accept === 'text/event-stream';
    const startTime = Date.now();

    if (useSSE) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const uploads = await storage.getAllUploads();
        const projectFiles = new Map<string, { filePath: string; fileName: string; uploadedAt: Date }>();
        for (const upload of uploads) {
          if (!upload.filePath) continue;
          const projectName = upload.fileName.replace(/\.(xlsx|xlsm|xls)$/i, '').replace(/_[Tt]racker\d*$/, '').replace(/^\d+_/, '').replace(/_/g, ' ').trim();
          const existing = projectFiles.get(projectName);
          if (!existing || (upload.uploadedAt && existing.uploadedAt < upload.uploadedAt)) {
            projectFiles.set(projectName, { filePath: upload.filePath, fileName: upload.fileName, uploadedAt: upload.uploadedAt || new Date(0) });
          }
        }

        const total = projectFiles.size;
        sendEvent({ type: 'start', total });
        const refreshResults: any[] = [];
        let processed = 0;

        for (const [projectName, fileInfo] of Array.from(projectFiles.entries())) {
          processed++;
          try {
            if (!fs.existsSync(fileInfo.filePath)) {
              refreshResults.push({ fileName: fileInfo.fileName, projectName, status: "error", message: "Source file not found on disk" });
              sendEvent({ type: 'progress', current: processed, total, fileName: fileInfo.fileName, projectName, status: 'error' });
              continue;
            }
            const fileBuffer = fs.readFileSync(fileInfo.filePath);
            const parseResult = await parseTrackerFile(fileBuffer, fileInfo.fileName);
            await applyFontColors(parseResult.expenses, fileBuffer);
            await storage.transaction(async (txStorage) => {
              await txStorage.deleteProgramExpensesByProject(parseResult.projectName);
              await txStorage.deleteProgramInflowsByProject(parseResult.projectName);
              await txStorage.deleteProjectPlansByProject(parseResult.projectName);
              await txStorage.deleteCashflowPointsByProject(parseResult.projectName);
              await txStorage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
              await txStorage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
              if (parseResult.projectInfo) { safeguardImportProjectInfo(parseResult.projectInfo); await txStorage.upsertProjectInfo(parseResult.projectInfo); }
              if (parseResult.expenses.length > 0) await txStorage.createManyProgramExpenses(parseResult.expenses);
              if (parseResult.inflows.length > 0) await txStorage.createManyProgramInflows(parseResult.inflows);
              if (parseResult.planItems.length > 0) await txStorage.createManyProjectPlans(parseResult.planItems);
              if (parseResult.cashflowPoints.length > 0) await txStorage.createManyCashflowPoints(parseResult.cashflowPoints);
              if (parseResult.financeRevenueMonthly.length > 0) await txStorage.createManyFinanceRevenueMonthly(parseResult.financeRevenueMonthly);
              if (parseResult.financeCosMonthly.length > 0) await txStorage.createManyFinanceCosMonthly(parseResult.financeCosMonthly);
            });
            const recordsProcessed = parseResult.expensesParsed + parseResult.inflowsParsed + parseResult.planParsed + parseResult.cashflowParsed + parseResult.financeRevenueParsed + parseResult.financeCosParsed;
            refreshResults.push({ fileName: fileInfo.fileName, projectName: parseResult.projectName, status: "success", recordsProcessed });
            sendEvent({ type: 'progress', current: processed, total, fileName: fileInfo.fileName, projectName: parseResult.projectName, status: 'success' });
          } catch (error: any) {
            refreshResults.push({ fileName: fileInfo.fileName, projectName, status: "error", message: error.message || "Refresh failed" });
            sendEvent({ type: 'progress', current: processed, total, fileName: fileInfo.fileName, projectName, status: 'error' });
          }
        }

        await storage.createRefreshLog({ triggeredBy: req.user?.id || null, status: refreshResults.every(r => r.status === "success") ? "success" : "partial" });
        const refreshActiveNames = refreshResults.filter(r => r.status === "success").map(r => r.projectName);
        if (refreshActiveNames.length > 0) await storage.markProjectsActive(refreshActiveNames);
        logAuditFromReq(req, { entityType: "system", action: "admin_refresh_data", source: "SYSTEM", changesJson: { projectsProcessed: total, durationMs: Date.now() - startTime } });
        sendEvent({ type: 'complete', results: refreshResults, durationMs: Date.now() - startTime });
        res.end();
      } catch (error: any) {
        sendEvent({ type: 'error', message: error.message });
        res.end();
      }
      return;
    }

    try {
      const uploads = await storage.getAllUploads();
      const refreshResults: { 
        fileName: string; 
        projectName: string;
        status: string; 
        message?: string;
        recordsProcessed?: number;
      }[] = [];
      
      const projectFiles = new Map<string, { filePath: string; fileName: string; uploadedAt: Date }>();
      for (const upload of uploads) {
        if (!upload.filePath) continue;
        const projectName = upload.fileName.replace(/\.(xlsx|xlsm|xls)$/i, '').replace(/_[Tt]racker\d*$/, '').replace(/^\d+_/, '').replace(/_/g, ' ').trim();
        const existing = projectFiles.get(projectName);
        if (!existing || (upload.uploadedAt && existing.uploadedAt < upload.uploadedAt)) {
          projectFiles.set(projectName, { 
            filePath: upload.filePath, 
            fileName: upload.fileName,
            uploadedAt: upload.uploadedAt || new Date(0)
          });
        }
      }
      
      for (const [projectName, fileInfo] of Array.from(projectFiles.entries())) {
        try {
          if (!fs.existsSync(fileInfo.filePath)) {
            refreshResults.push({ fileName: fileInfo.fileName, projectName, status: "error", message: "Source file not found on disk" });
            continue;
          }
          const fileBuffer = fs.readFileSync(fileInfo.filePath);
          const parseResult = await parseTrackerFile(fileBuffer, fileInfo.fileName);
          await applyFontColors(parseResult.expenses, fileBuffer);
          await storage.transaction(async (txStorage) => {
            await txStorage.deleteProgramExpensesByProject(parseResult.projectName);
            await txStorage.deleteProgramInflowsByProject(parseResult.projectName);
            await txStorage.deleteProjectPlansByProject(parseResult.projectName);
            await txStorage.deleteCashflowPointsByProject(parseResult.projectName);
            await txStorage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
            await txStorage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
            if (parseResult.projectInfo) { safeguardImportProjectInfo(parseResult.projectInfo); await txStorage.upsertProjectInfo(parseResult.projectInfo); }
            if (parseResult.expenses.length > 0) await txStorage.createManyProgramExpenses(parseResult.expenses);
            if (parseResult.inflows.length > 0) await txStorage.createManyProgramInflows(parseResult.inflows);
            if (parseResult.planItems.length > 0) await txStorage.createManyProjectPlans(parseResult.planItems);
            if (parseResult.cashflowPoints.length > 0) await txStorage.createManyCashflowPoints(parseResult.cashflowPoints);
            if (parseResult.financeRevenueMonthly.length > 0) await txStorage.createManyFinanceRevenueMonthly(parseResult.financeRevenueMonthly);
            if (parseResult.financeCosMonthly.length > 0) await txStorage.createManyFinanceCosMonthly(parseResult.financeCosMonthly);
          });
          const recordsProcessed = parseResult.expensesParsed + parseResult.inflowsParsed + 
            parseResult.planParsed + parseResult.cashflowParsed + 
            parseResult.financeRevenueParsed + parseResult.financeCosParsed;
          refreshResults.push({ fileName: fileInfo.fileName, projectName: parseResult.projectName, status: "success", message: `Refreshed from source`, recordsProcessed });
        } catch (error: any) {
          refreshResults.push({ fileName: fileInfo.fileName, projectName, status: "error", message: error.message || "Refresh failed" });
        }
      }
      
      await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: refreshResults.every(r => r.status === "success") ? "success" : "partial"
      });

      const refreshActiveNamesNonSSE = refreshResults.filter(r => r.status === "success").map(r => r.projectName);
      if (refreshActiveNamesNonSSE.length > 0) await storage.markProjectsActive(refreshActiveNamesNonSSE);
      
      const endTime = Date.now();
      const successCount = refreshResults.filter(r => r.status === "success").length;
      const totalRecords = refreshResults.reduce((sum, r) => sum + (r.recordsProcessed || 0), 0);
      
      res.json({
        success: true,
        message: `Refreshed ${successCount}/${projectFiles.size} project(s)`,
        projectsRefreshed: successCount,
        projectsTotal: projectFiles.size,
        totalRecordsProcessed: totalRecords,
        results: refreshResults,
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date(endTime).toISOString(),
          durationMs: endTime - startTime
        }
      });
      
    } catch (error: any) {
      console.error("Data refresh error:", error);
      res.status(500).json({ 
        success: false,
        error: "refresh_failed",
        message: error.message || "Failed to refresh data from source files",
        code: "REFRESH_DATA_ERROR",
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date().toISOString(),
          durationMs: Date.now() - startTime
        }
      });
    }
  });

  // Clear all data
  app.post("/api/admin/clear-all-data", requireAuth, requireAdmin, requirePermission('admin', 'edit'), async (req, res) => {
    const startTime = Date.now();
    
    try {
      const result = await storage.clearAllData();
      logAuditFromReq(req, { entityType: "admin", action: "clear_all_data", changesJson: { description: "All data cleared", tablesCleared: result.tablesCleared.length, filesDeleted: result.filesDeleted } });
      res.json({
        success: true,
        message: `Cleared ${result.tablesCleared.length} tables and deleted ${result.filesDeleted} file(s)`,
        tablesCleared: result.tablesCleared,
        filesDeleted: result.filesDeleted,
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date().toISOString(),
          durationMs: Date.now() - startTime
        }
      });
    } catch (error: any) {
      console.error("Clear all data error:", error);
      res.status(500).json({ 
        success: false,
        error: "clear_failed",
        message: error.message || "Failed to clear all data"
      });
    }
  });

  // Get/set folder path for data import
  app.get("/api/admin/folder-config", requireAuth, requireAdmin, async (req, res) => {
    try {
      const folderPath = process.env.TRACKER_FOLDER_PATH || path.join(process.cwd(), 'uploads');
      const exists = fs.existsSync(folderPath);
      let fileCount = 0;
      let latestFileDate: string | null = null;
      
      if (exists) {
        const files = fs.readdirSync(folderPath).filter(f => /\.(xlsx|xlsm|xls)$/i.test(f));
        fileCount = files.length;
        
        let maxMtime = 0;
        for (const file of files) {
          const stat = fs.statSync(path.join(folderPath, file));
          if (stat.mtimeMs > maxMtime) {
            maxMtime = stat.mtimeMs;
            latestFileDate = stat.mtime.toISOString();
          }
        }
      }

      const projectCounts = await storage.getProjectCounts();
      
      res.json({ folderPath, exists, fileCount, latestFileDate, projectCounts });
    } catch (error: any) {
      logApiError("GET /api/admin/folder-config", error);
      return sendError(res, new ApiError(500, "FOLDER_CONFIG_READ_FAILED", "Failed to read folder config"));
    }
  });

  app.post("/api/admin/folder-config", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { folderPath } = req.body;
      if (!folderPath) {
        return sendError(res, badRequest("folderPath required"));
      }
      
      const resolvedPath = path.resolve(folderPath);
      const exists = fs.existsSync(resolvedPath);
      
      if (!exists) {
        return sendError(res, new ApiError(400, "FOLDER_NOT_FOUND", "Folder does not exist", { path: resolvedPath }));
      }
      
      process.env.TRACKER_FOLDER_PATH = resolvedPath;
      
      const files = fs.readdirSync(resolvedPath).filter(f => /\.(xlsx|xlsm|xls)$/i.test(f));
      logAuditFromReq(req, { entityType: "admin", action: "folder_config", changesJson: { description: "Folder path configured", folderPath: resolvedPath, fileCount: files.length } });
      res.json({ 
        success: true, 
        folderPath: resolvedPath, 
        fileCount: files.length,
        message: `Folder set to ${resolvedPath} (${files.length} Excel files found)` 
      });
    } catch (error: any) {
      logApiError("POST /api/admin/folder-config", error);
      return sendError(res, new ApiError(500, "FOLDER_CONFIG_WRITE_FAILED", "Failed to set folder"));
    }
  });

  // Scan folder and process all Excel files
  app.post("/api/admin/scan-folder", requireAuth, requireAdmin, async (req, res) => {
    const startTime = Date.now();
    
    try {
      const folderPath = process.env.TRACKER_FOLDER_PATH || path.join(process.cwd(), 'uploads');
      
      if (!fs.existsSync(folderPath)) {
        return res.status(400).json({ 
          success: false, 
          error: "folder_not_found",
          message: `Folder not found: ${folderPath}` 
        });
      }
      
      const allFiles = fs.readdirSync(folderPath).filter(f => /\.(xlsx|xlsm|xls)$/i.test(f));
      
      if (allFiles.length === 0) {
        return res.json({
          success: true,
          message: "No Excel files found in folder",
          filesProcessed: 0,
          filesTotal: 0,
          results: [],
          timestamps: {
            started: new Date(startTime).toISOString(),
            completed: new Date().toISOString(),
            durationMs: Date.now() - startTime
          }
        });
      }
      
      const results: {
        fileName: string;
        projectName: string;
        status: "success" | "failed";
        message: string;
        recordsProcessed?: number;
        fileDate: string;
      }[] = [];
      
      for (const fileName of allFiles) {
        const filePath = path.join(folderPath, fileName);
        let fileDate = "";
        
        try {
          const stat = fs.statSync(filePath);
          fileDate = stat.mtime.toISOString();
          
          const fileBuffer = fs.readFileSync(filePath);
          const parseResult = await parseTrackerFile(fileBuffer, fileName);
          await applyFontColors(parseResult.expenses, fileBuffer);
          
          await storage.transaction(async (txStorage) => {
            // Delete existing data for this project
            await txStorage.deleteProgramExpensesByProject(parseResult.projectName);
            await txStorage.deleteProgramInflowsByProject(parseResult.projectName);
            await txStorage.deleteProjectPlansByProject(parseResult.projectName);
            await txStorage.deleteCashflowPointsByProject(parseResult.projectName);
            await txStorage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
            await txStorage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
            
            if (parseResult.projectInfo) {
              safeguardImportProjectInfo(parseResult.projectInfo);
              await txStorage.upsertProjectInfo(parseResult.projectInfo);
            }
            if (parseResult.expenses.length > 0) {
              await txStorage.createManyProgramExpenses(parseResult.expenses);
            }
            if (parseResult.inflows.length > 0) {
              await txStorage.createManyProgramInflows(parseResult.inflows);
            }
            if (parseResult.planItems.length > 0) {
              await txStorage.createManyProjectPlans(parseResult.planItems);
            }
            if (parseResult.cashflowPoints.length > 0) {
              await txStorage.createManyCashflowPoints(parseResult.cashflowPoints);
            }
            if (parseResult.financeRevenueMonthly.length > 0) {
              await txStorage.createManyFinanceRevenueMonthly(parseResult.financeRevenueMonthly);
            }
            if (parseResult.financeCosMonthly.length > 0) {
              await txStorage.createManyFinanceCosMonthly(parseResult.financeCosMonthly);
            }
          });
          
          // Also save a copy to uploads dir and record in upload_metadata
          const destPath = path.join(uploadDir, `${Date.now()}_${fileName}`);
          fs.copyFileSync(filePath, destPath);
          await storage.createUpload({
            fileName,
            filePath: destPath,
          });

          try {
            const preview = await runSmartImportPreview(fileBuffer, fileName);
            const norm = preview.normalization;
            const resolvedProjectName = parseResult.projectName;
            const [existingProject] = await db.select({ id: projectInfo.id }).from(projectInfo)
              .where(eq(projectInfo.projectName, resolvedProjectName));
            const pId = existingProject?.id || null;

            if (pId) {
              await db.delete(workItems).where(
                and(
                  eq(workItems.projectId, pId),
                  eq(workItems.workstream, 'PM' as any),
                  eq(workItems.source, 'SMART_IMPORT' as any)
                )
              );
            }

            const dummyRun = await db.insert(smartImportRuns).values({
              fileName,
              projectName: resolvedProjectName,
              projectId: pId,
              uploadedBy: req.user?.id || null,
              status: "COMMITTED",
              committedAt: new Date(),
              committedBy: req.user?.id || null,
              summaryJson: {} as any,
            }).returning();
            const importRunId = dummyRun[0].id;

            if (norm.planTasks.length > 0) {
              await db.insert(workItems).values(norm.planTasks.map((t: any, idx: number) => ({
                projectId: pId,
                workstream: 'PM' as any,
                source: 'SMART_IMPORT' as any,
                title: t.taskName,
                wbsCode: t.taskNo || null,
                type: t.phase,
                startDate: t.startDate,
                endDate: t.endDate,
                duration: t.durationDays,
                actualStart: t.actualStartDate || null,
                actualEnd: t.actualEndDate || null,
                actualDuration: t.actualDurationDays || null,
                ownerName: t.owner,
                status: t.status || 'Not Started',
                percentComplete: t.pctComplete,
                description: t.comment,
                sourceSheet: t.sourceSheet,
                sourceRow: t.sourceRow,
                importRunId,
                externalRef: `${resolvedProjectName}::PLAN::${t.taskNo || idx}::${importRunId}`,
              })));
            }
            console.log(`[FolderScan] Populated work_items with actual dates for "${resolvedProjectName}"`);
          } catch (normErr: any) {
            console.error("[FolderScan] Non-blocking work_items population failed:", normErr.message);
          }
          
          const recordsProcessed = parseResult.expensesParsed + parseResult.inflowsParsed + 
            parseResult.planParsed + parseResult.cashflowParsed + 
            parseResult.financeRevenueParsed + parseResult.financeCosParsed;
          
          results.push({
            fileName,
            projectName: parseResult.projectName,
            status: "success",
            message: `Processed successfully`,
            recordsProcessed,
            fileDate
          });
          
        } catch (error: any) {
          results.push({
            fileName,
            projectName: fileName.replace(/\.(xlsx|xlsm|xls)$/i, ''),
            status: "failed",
            message: error.message || "Processing failed",
            fileDate
          });
        }
      }
      
      await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: results.every(r => r.status === "success") ? "success" : 
               results.some(r => r.status === "success") ? "partial" : "failed"
      });

      const activeProjectNames = results
        .filter(r => r.status === "success")
        .map(r => r.projectName);
      if (activeProjectNames.length > 0) {
        await storage.markProjectsActive(activeProjectNames);
      }
      
      const endTime = Date.now();
      const successCount = results.filter(r => r.status === "success").length;
      const failedCount = results.filter(r => r.status === "failed").length;
      const totalRecords = results.reduce((sum, r) => sum + (r.recordsProcessed || 0), 0);
      
      logAuditFromReq(req, { entityType: "system", action: "scan_folder", source: "SYSTEM", changesJson: { filesProcessed: successCount, filesFailed: failedCount, filesTotal: allFiles.length, totalRecords } });

      res.json({
        success: failedCount < results.length,
        message: `Processed ${successCount}/${allFiles.length} files (${failedCount} failed)`,
        filesProcessed: successCount,
        filesFailed: failedCount,
        filesTotal: allFiles.length,
        totalRecordsProcessed: totalRecords,
        latestFileDate: results.reduce((latest, r) => r.fileDate > latest ? r.fileDate : latest, ""),
        results,
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date(endTime).toISOString(),
          durationMs: endTime - startTime
        }
      });
      
    } catch (error: any) {
      console.error("Folder scan error:", error);
      res.status(500).json({ 
        success: false,
        error: "scan_failed",
        message: error.message || "Failed to scan folder",
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date().toISOString(),
          durationMs: Date.now() - startTime
        }
      });
    }
  });

  app.post("/api/admin/mark-active", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectNames } = req.body;
      if (!Array.isArray(projectNames)) {
        return res.status(400).json({ error: "projectNames must be an array" });
      }
      await storage.markProjectsActive(projectNames);
      const counts = await storage.getProjectCounts();
      logAuditFromReq(req, { entityType: "admin", action: "mark_active", changesJson: { description: `${projectNames.length} project(s) marked active`, projectNames } });
      res.json({ success: true, projectCounts: counts });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to mark projects active", message: error.message });
    }
  });

  // Get refresh history
  app.get("/api/admin/refresh-history", requireAuth, requireAdmin, async (req, res) => {
    try {
      const uploads = await storage.getAllUploads();
      const latest = await storage.getLatestRefresh();
      
      // Get unique source files
      const sourceFiles = new Map<string, { fileName: string; filePath: string; exists: boolean; uploadedAt: string }>();
      for (const upload of uploads) {
        if (!upload.filePath) continue;
        const projectName = upload.fileName.replace(/\.(xlsx|xlsm|xls)$/i, '').replace(/_[Tt]racker\d*$/, '').replace(/^\d+_/, '').replace(/_/g, ' ').trim();
        
        const existing = sourceFiles.get(projectName);
        if (!existing || (upload.uploadedAt && new Date(existing.uploadedAt) < upload.uploadedAt)) {
          sourceFiles.set(projectName, {
            fileName: upload.fileName,
            filePath: upload.filePath,
            exists: fs.existsSync(upload.filePath),
            uploadedAt: upload.uploadedAt?.toISOString() || ''
          });
        }
      }
      
      res.json({
        lastRefresh: latest?.refreshedAt?.toISOString() || null,
        lastRefreshStatus: latest?.status || null,
        sourceFilesCount: sourceFiles.size,
        sourceFiles: Array.from(sourceFiles.entries()).map(([project, info]) => ({
          projectName: project,
          ...info
        }))
      });
    } catch (error: any) {
      res.status(500).json({ 
        error: "refresh_history_failed", 
        message: error.message || "Failed to fetch refresh history",
        code: "REFRESH_HISTORY_ERROR" 
      });
    }
  });

  // ==================== UPLOAD HISTORY ROUTE ====================

  app.get("/api/uploads", requireAuth, async (req, res) => {
    try {
      const uploads = await storage.getAllUploads();
      res.json(uploads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch upload history", message: "Failed to fetch upload history" });
    }
  });

  // ==================== CSV EXPORT ROUTES ====================

  app.get("/api/export/projects", requireAuth, async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      const csv = generateCSV(projects, [
        "id", "code", "name", "manager", "site", "status", "stage", 
        "startDate", "completionDate", "budget", "sourceFile"
      ]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=projects_export.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Export failed", message: "Export failed" });
    }
  });

  app.get("/api/export/expenses", requireAuth, async (req, res) => {
    try {
      const expenses = await storage.getAllProgramExpenses();
      const csv = generateCSV(expenses, [
        "id", "projectName", "expenseCategory", "expenseLineItem", 
        "expenseActualTotal", "expensePoNumber", "expenseInvoiceNumber",
        "expensePaymentDate", "cosAmount"
      ]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=expenses_export.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Export failed", message: "Export failed" });
    }
  });

  app.get("/api/export/revenues", requireAuth, async (req, res) => {
    try {
      const revenues = await storage.getAllProgramInflows();
      const csv = generateCSV(revenues, [
        "id", "projectName", "milestoneNo", "milestoneName", 
        "milestoneAmount", "plannedPaymentDate", "milestoneInvoiceNumber",
        "paymentReceivedDate"
      ]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=revenues_export.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Export failed", message: "Export failed" });
    }
  });

  app.get("/api/export/tasks", requireAuth, async (req, res) => {
    try {
      const tasks = await storage.getAllTasks();
      const csv = generateCSV(tasks, [
        "id", "projectId", "taskName", "startDate", "endDate", 
        "progress", "status", "assignee", "sourceSheet", "rowLocator"
      ]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=tasks_export.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Export failed", message: "Export failed" });
    }
  });

  app.get("/api/export/projects-summary", requireAuth, async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const response = await fetch(`http://0.0.0.0:${process.env.PORT || 5000}/api/projects-summary`, {
        headers: { Authorization: authHeader },
      });
      const summary = await response.json();
      const csv = generateCSV(summary, [
        "project_name", "size_kwp", "pd", "pm", "phase",
        "pd_handover_date", "construction_start_date", "commissioning_date", 
        "om_handover_date", "client_handover_date",
        "project_pct_complete", "expected_pct_complete", "delta_vs_expected",
        "actual_revenue", "actual_expenses", "gp_percent",
        "revenue_outstanding", "expenses_outstanding"
      ]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=projects_summary_export.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Export failed", message: "Export failed" });
    }
  });

  // ==================== ADMIN SMOKE TEST ====================
  
  app.get("/api/admin/smoke-test", requireAuth, requireAdmin, async (req, res) => {
    const startTime = Date.now();
    const checks: { name: string; passed: boolean; details: any }[] = [];
    
    const addCheck = (name: string, passed: boolean, details: any = {}) => {
      checks.push({ name, passed, details });
    };

    try {
      // 1. Health Check
      try {
        const { dbMode } = await import("./db");
        const { getDbConfigStatus } = await import("./db-config");
        const dbStatus = getDbConfigStatus();
        
        const healthPassed = dbStatus.connected === true;
        addCheck("health", healthPassed, {
          ok: dbStatus.connected,
          dbMode,
          dbConnected: dbStatus.connected,
          dbHost: dbStatus.host,
          message: dbStatus.message
        });
      } catch (err: any) {
        addCheck("health", false, { error: err.message });
      }

      // 2. Auth Check - Verify admin user exists
      try {
        const adminUser = await storage.getUserByEmail("admin@emergent.energy");
        const adminExists = !!adminUser;
        
        addCheck("auth_admin_exists", adminExists, {
          email: "admin@emergent.energy",
          exists: adminExists,
          role: adminUser?.role || null
        });
      } catch (err: any) {
        addCheck("auth_admin_exists", false, { error: err.message });
      }

      // 3. Import runs baseline - Check DB import history (no disk files)
      try {
        const importRuns = await db.execute(sql`
          SELECT COUNT(*) as count FROM smart_import_runs WHERE status = 'COMMITTED'
        `);
        const rows = Array.isArray(importRuns) ? importRuns : (importRuns.rows || []);
        const count = Number(rows[0]?.count || 0);
        addCheck("import_runs_available", count > 0, { committedRuns: count });
      } catch (err: any) {
        addCheck("import_runs_available", false, { error: err.message });
      }

      // 4. Projects data check
      try {
        const projects = await storage.getAllProjectInfo();
        const projectCount = projects.length;
        
        addCheck("projects_exist", projectCount >= 1, {
          count: projectCount,
          projects: projects.map(p => p.projectName).slice(0, 10)
        });
      } catch (err: any) {
        addCheck("projects_exist", false, { error: err.message });
      }

      // 5. Cashflow data check - verify 8 series names
      try {
        const cashflowPoints = await storage.getAllCashflowPoints();
        const seriesNames = Array.from(new Set(cashflowPoints.map(p => p.seriesName)));
        
        const requiredSeries = [
          "Planned Revenue", "ACTUAL Revenue",
          "Planned Expenditure", "ACTUAL Expenditure",
          "Planned CashFlow", "ACTUAL CashFlow",
          "Planned Cumulative", "ACTUAL Cumulative"
        ];
        
        const missingSeries = requiredSeries.filter(s => !seriesNames.includes(s));
        const nonZeroPoints = cashflowPoints.filter(p => parseFloat(String(p.value)) !== 0).length;
        
        addCheck("cashflow_series", missingSeries.length === 0, {
          foundSeries: seriesNames,
          requiredSeries,
          missingSeries,
          totalPoints: cashflowPoints.length,
          nonZeroPoints
        });
        
        addCheck("cashflow_nonzero", nonZeroPoints >= 10, {
          nonZeroPoints,
          threshold: 10
        });
      } catch (err: any) {
        addCheck("cashflow_series", false, { error: err.message });
        addCheck("cashflow_nonzero", false, { error: err.message });
      }

      // 6. Revenue data check (normalized_revenue_lines)
      try {
        const projects = await storage.getAllProjectInfo();
        let totalInflows = 0;
        
        for (const project of projects.slice(0, 5)) {
          const inflows = await storage.getProgramInflowsByProject(project.projectName);
          totalInflows += inflows.length;
        }
        
        addCheck("revenue_data", totalInflows > 0, {
          totalInflows,
          projectsChecked: Math.min(projects.length, 5)
        });
      } catch (err: any) {
        addCheck("revenue_data", false, { error: err.message });
      }

      // 7. COS data check (normalized_cost_lines)
      try {
        const projects = await storage.getAllProjectInfo();
        let totalExpenses = 0;
        
        for (const project of projects.slice(0, 5)) {
          const expenses = await storage.getProgramExpensesByProject(project.projectName);
          totalExpenses += expenses.length;
        }
        
        addCheck("cos_data", totalExpenses > 0, {
          totalExpenses,
          projectsChecked: Math.min(projects.length, 5)
        });
      } catch (err: any) {
        addCheck("cos_data", false, { error: err.message });
      }

      // 8. Override test - create, verify, cleanup
      try {
        const testProjectName = "SMOKE_TEST_PROJECT";
        const testWeekStart = "2025-01-06";
        const testSeriesName = "Planned Revenue";
        const testOverrideValue = "99999.99";
        
        // Create override
        await storage.upsertPlanningOverride({
          projectName: testProjectName,
          weekStartDate: testWeekStart,
          seriesName: testSeriesName,
          overrideValue: testOverrideValue
        });
        
        // Verify override exists
        const overrides = await storage.getPlanningOverridesByProject(testProjectName);
        const found = overrides.find(o => 
          o.weekStartDate === testWeekStart && 
          o.seriesName === testSeriesName
        );
        
        const overridePassed = !!(found && String(found.overrideValue) === testOverrideValue);
        
        // Cleanup
        await storage.deletePlanningOverridesByProject(testProjectName);
        
        addCheck("override_test", overridePassed, {
          created: true,
          found: !!found,
          valueMatches: found ? String(found.overrideValue) === testOverrideValue : false,
          cleanedUp: true
        });
      } catch (err: any) {
        addCheck("override_test", false, { error: err.message });
      }

      // 9. Finance Revenue Monthly check
      try {
        const projects = await storage.getAllProjectInfo();
        let totalFinRevRows = 0;
        
        for (const project of projects.slice(0, 3)) {
          const finRev = await storage.getFinanceRevenueMonthlyByProject(project.projectName);
          totalFinRevRows += finRev.length;
        }
        
        addCheck("finance_revenue", totalFinRevRows > 0, {
          totalRows: totalFinRevRows,
          projectsChecked: Math.min(projects.length, 3)
        });
      } catch (err: any) {
        addCheck("finance_revenue", false, { error: err.message });
      }

      // 10. Finance COS Monthly check
      try {
        const projects = await storage.getAllProjectInfo();
        let totalFinCosRows = 0;
        
        for (const project of projects.slice(0, 3)) {
          const finCos = await storage.getFinanceCosMonthlyByProject(project.projectName);
          totalFinCosRows += finCos.length;
        }
        
        addCheck("finance_cos", totalFinCosRows > 0, {
          totalRows: totalFinCosRows,
          projectsChecked: Math.min(projects.length, 3)
        });
      } catch (err: any) {
        addCheck("finance_cos", false, { error: err.message });
      }

      const endTime = Date.now();
      const allPassed = checks.every(c => c.passed);
      
      res.json({
        passed: allPassed,
        checks,
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date(endTime).toISOString(),
          durationMs: endTime - startTime
        }
      });
      
    } catch (error: any) {
      res.status(500).json({
        passed: false,
        checks,
        error: "smoke_test_error",
        message: error.message || "Smoke test failed unexpectedly",
        code: "smoke_test_error",
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date().toISOString(),
          durationMs: Date.now() - startTime
        }
      });
    }
  });

  // Working plan routes extracted to ./routes/working-plan-routes.ts
  registerWorkingPlanRoutes(app);


  // ==================== GLOBAL API ERROR HANDLER ====================
  // Catch any unhandled errors and return proper JSON
  app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[API Error Handler]', err);
    
    // Multer file size/type errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: 'File too large. Maximum file size is 50MB.',
        code: 'LIMIT_FILE_SIZE'
      });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'unexpected_field',
        message: 'Unexpected form field. Expected files/file/tracker.',
        code: 'LIMIT_UNEXPECTED_FILE'
      });
    }
    
    // Generic error with message
    const errorMessage = err.message || 'Internal server error';
    const statusCode = err.status || err.statusCode || 500;
    const errorCode = err.code || 'server_error';
    
    res.status(statusCode).json({
      error: errorCode,
      message: errorMessage,
      code: errorCode,
      detail: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  // COS control, scenario, cashflow forecast, and planning board routes extracted to ./routes/cos-control-routes.ts
  registerCosControlRoutes(app);


  // Operational tasks routes extracted to ./routes/operational-tasks-routes.ts
  registerOperationalTasksRoutes(app);


  // Planning tasks routes extracted to ./routes/planning-tasks-routes.ts
  registerPlanningTasksRoutes(app);


  // ==================== WRITEBACK MAPPINGS ====================

  app.get("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getAllWritebackMappings();
      res.json(mappings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mapping = await storage.createWritebackMapping(req.body);
      logAuditFromReq(req, { entityType: "writeback_mapping", action: "create", entityId: String(mapping.id), changesJson: { description: "Writeback mapping created" } });
      res.json(mapping);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateWritebackMapping(id, req.body);
      logAuditFromReq(req, { entityType: "writeback_mapping", action: "update", entityId: req.params.id, changesJson: { description: "Writeback mapping updated" } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteWritebackMapping(id);
      logAuditFromReq(req, { entityType: "writeback_mapping", action: "delete", entityId: req.params.id, changesJson: { description: "Writeback mapping deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== WRITEBACK AUDIT LOG ====================

  app.get("/api/writeback-audit", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mappingId = req.query.mappingId ? parseInt(req.query.mappingId as string) : undefined;
      const logs = await storage.getWritebackAuditLogs(mappingId);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== WRITEBACK EXECUTION ====================

  const safeUploadsDir = path.resolve(process.cwd(), 'uploads');
  function validateWorkbookPath(wbPath: string): { safe: boolean; resolved: string; error?: string } {
    const resolved = path.resolve(safeUploadsDir, wbPath);
    if (!resolved.startsWith(safeUploadsDir)) {
      return { safe: false, resolved, error: "Path must be within the uploads directory" };
    }
    return { safe: true, resolved };
  }

  app.get("/api/writeback/workbook-sheets", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { path: wbPath } = req.query;
      if (!wbPath) return res.status(400).json({ error: "path query param required" });
      const check = validateWorkbookPath(wbPath as string);
      if (!check.safe) return res.status(400).json({ error: check.error });
      const { getWorkbookSheets } = await import("./lib/writebackEngine");
      const sheets = await getWorkbookSheets(check.resolved);
      res.json({ sheets });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  async function buildDataByEntity(): Promise<Record<string, any[]>> {
    const projects = await storage.getAllProjects();
    const expenses = await storage.getAllExpenses();
    const inflows = await storage.getAllProgramInflows();
    return { project: projects, expense: expenses, inflow: inflows, plan: [] };
  }

  app.post("/api/writeback/preview", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { workbookPath, mappingIds } = req.body;
      if (!workbookPath) return res.status(400).json({ error: "workbookPath required" });
      const check = validateWorkbookPath(workbookPath);
      if (!check.safe) return res.status(400).json({ error: check.error });

      let mappings = await storage.getAllWritebackMappings();
      if (mappingIds && Array.isArray(mappingIds)) {
        mappings = mappings.filter((m: any) => mappingIds.includes(m.id));
      }
      mappings = mappings.filter((m: any) => m.workbookPath === workbookPath);

      const dataByEntity = await buildDataByEntity();

      const { previewWriteback } = await import("./lib/writebackEngine");
      const preview = await previewWriteback(check.resolved, mappings, dataByEntity);
      res.json(preview);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/writeback/execute", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { workbookPath, mappingIds, outputPath } = req.body;
      if (!workbookPath) return res.status(400).json({ error: "workbookPath required" });
      const check = validateWorkbookPath(workbookPath);
      if (!check.safe) return res.status(400).json({ error: check.error });
      if (outputPath) {
        const outCheck = validateWorkbookPath(outputPath);
        if (!outCheck.safe) return res.status(400).json({ error: outCheck.error });
      }

      let mappings = await storage.getAllWritebackMappings();
      if (mappingIds && Array.isArray(mappingIds)) {
        mappings = mappings.filter((m: any) => mappingIds.includes(m.id));
      }
      mappings = mappings.filter((m: any) => m.workbookPath === workbookPath);

      if (mappings.length === 0) {
        return res.status(400).json({ error: "No mappings found for this workbook" });
      }

      const dataByEntity = await buildDataByEntity();

      const { executeWriteback, writeToWorkbook } = await import("./lib/writebackEngine");
      const batchResults = executeWriteback(mappings, dataByEntity);

      const writes: Array<{ sheetName: string; cellAddress: string; value: string }> = [];
      for (const batch of batchResults) {
        for (const result of batch.results) {
          if (result.status === "applied") {
            const mapping = mappings.find((m: any) => m.id === result.mappingId);
            if (mapping) {
              writes.push({
                sheetName: mapping.sheetName,
                cellAddress: result.cellAddress,
                value: result.newValue,
              });
            }
          }
        }
      }

      const resolvedOutputPath = outputPath ? validateWorkbookPath(outputPath).resolved : undefined;
      const writeResult = await writeToWorkbook(check.resolved, writes, resolvedOutputPath);

      const userId = (req as any).user?.id;
      for (const batch of batchResults) {
        for (const result of batch.results) {
          const mapping = mappings.find((m: any) => m.id === result.mappingId);
          if (mapping) {
            const prevVal = writeResult.previousValues.get(`${mapping.sheetName}!${result.cellAddress}`);
            await storage.createWritebackAuditLog({
              mappingId: mapping.id,
              workbookPath: batch.workbookPath,
              sheetName: mapping.sheetName,
              cellAddress: result.cellAddress,
              previousValue: prevVal ?? result.previousValue,
              newValue: result.newValue,
              status: writeResult.success ? result.status : "failed",
              projectId: mapping.projectName,
              actorId: userId,
              errorMessage: result.errorMessage || writeResult.error || null,
            });
          }
        }
      }

      logAuditFromReq(req, { entityType: "writeback", action: "execute", changesJson: { description: "Writeback executed", workbookPath, mappingCount: mappings.length, success: writeResult.success } });
      res.json({
        success: writeResult.success,
        error: writeResult.error,
        batches: batchResults,
        outputPath: outputPath || workbookPath,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/writeback/rollback/:auditId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const auditId = parseInt(req.params.auditId);
      const logs = await storage.getWritebackAuditLogs();
      const auditEntry = logs.find((l: any) => l.id === auditId);
      if (!auditEntry) return res.status(404).json({ error: "Audit entry not found" });
      if (auditEntry.rolledBackAt) return res.status(400).json({ error: "Already rolled back" });
      if (auditEntry.previousValue === null) return res.status(400).json({ error: "No previous value to restore" });

      const rollbackCheck = validateWorkbookPath(auditEntry.workbookPath);
      if (!rollbackCheck.safe) return res.status(400).json({ error: rollbackCheck.error });

      const { writeToWorkbook } = await import("./lib/writebackEngine");
      const result = await writeToWorkbook(rollbackCheck.resolved, [{
        sheetName: auditEntry.sheetName,
        cellAddress: auditEntry.cellAddress,
        value: auditEntry.previousValue,
      }]);

      if (result.success) {
        await storage.updateWritebackAuditLog(auditId, { rolledBackAt: new Date() });
      }

      logAuditFromReq(req, { entityType: "writeback", action: "rollback", entityId: String(auditId), changesJson: { description: "Writeback rolled back", cellAddress: auditEntry.cellAddress, previousValue: auditEntry.previousValue } });
      res.json({ success: result.success, error: result.error });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - USER SCOPING HELPER ====================
  // EXTRACTED to server/routes/mytool-routes.ts — remove after verification (34 handlers below)

  /** Resolve effective userId for mytool queries.
   *  ADMIN and PROGRAM_MANAGER may pass ?userId= to view another user's data.
   *  All other roles get their own userId only. */
  const MYTOOL_OVERSIGHT_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];

  function resolveMyToolUserId(req: Request): number {
    const authUserId = (req.user as any).id;
    const role = (req.user as any).role;
    const requestedUserId = req.query.userId ? parseInt(req.query.userId as string) : null;
    if (requestedUserId && !isNaN(requestedUserId) && MYTOOL_OVERSIGHT_ROLES.includes(role)) {
      return requestedUserId;
    }
    return authUserId;
  }

  function isMyToolOversightRole(req: Request): boolean {
    return MYTOOL_OVERSIGHT_ROLES.includes((req.user as any).role);
  }

  // ==================== MY TOOL - SETTINGS ====================

  app.get("/api/mytool/settings", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getMytoolSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/settings", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateMytoolSettings(req.body);
      logAuditFromReq(req, { entityType: "mytool_settings", action: "update", changesJson: { description: "MyTool settings updated" } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== CALENDAR - COMBINED TASKS ====================

  app.get("/api/calendar/my-tasks", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const userName = (req.user as any).username;
      const displayName = (req.user as any).name || userName;

      const [myToolTasksResult, opTasksForUser, planTasksForUser, engTasksForUser, qcItemsForUser] = await Promise.all([
        db.select().from(mytoolTasks).where(eq(mytoolTasks.ownerUserId, userId)),
        db.select().from(workItems).where(
          and(
            isNull(workItems.deletedAt),
            or(
              eq(workItems.ownerUserId, userId),
              sql`EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = ${workItems.id} AND wia.user_id = ${userId})`
            )
          )
        ),
        db.execute(sql`
          SELECT wi.id, wi.title as task_name, wi.wbs_code as task_no, wi.start_date, wi.end_date,
                 wi.percent_complete as pct_complete, wi.duration as duration_days,
                 wi.owner_user_id as assignee_user_id, wi.status, wi.type as phase,
                 wi.scheduled_date, wi.scheduled_start_time, wi.scheduled_end_time,
                 pi.project_name
          FROM work_items wi
          LEFT JOIN project_info pi ON wi.project_id = pi.id
          WHERE wi.workstream = 'PM' AND wi.deleted_at IS NULL
            AND (wi.owner_user_id = ${userId}
              OR EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = wi.id AND wia.user_id = ${userId}))
        `),
        // Read ENG work_items
        db.select().from(workItems).where(
          and(
            eq(workItems.workstream, "ENG"),
            eq(workItems.ownerUserId, userId),
            isNull(workItems.deletedAt)
          )
        ),
        db.execute(sql`
          SELECT qi.*, qc.project_name, qc.project_id, qti.item_name
          FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN qc_template_item qti ON qi.template_item_id = qti.id
          WHERE qi.assignee_user_id = ${userId}
            AND qi.is_applicable = true
        `),
      ]);

      const seenOpIds = new Set<number>();
      const allOpTasks: typeof opTasksForUser = [];
      for (const t of opTasksForUser) {
        if (!seenOpIds.has(t.id)) {
          seenOpIds.add(t.id);
          allOpTasks.push(t);
        }
      }

      const combined = [
        ...myToolTasksResult.map((t) => ({
          id: t.id,
          taskType: "mytool" as const,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectName: t.projectName,
          plannedForDate: t.plannedForDate,
          dueDate: t.dueAt ? t.dueAt.toISOString().split("T")[0] : null,
          startDate: t.startDate,
          scheduledDate: t.scheduledDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
        })),
        ...allOpTasks.map((t: any) => ({
          id: t.id,
          taskType: "operational" as const,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectName: t.projectName || null,
          plannedForDate: null,
          dueDate: t.endDate || t.dueDate || null,
          startDate: t.startDate,
          scheduledDate: t.scheduledDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
        })),
        ...(planTasksForUser as any[]).map((t: any) => ({
          id: t.id,
          taskType: "plan" as const,
          title: t.task_name,
          status: t.status || "active",
          priority: "Medium",
          projectName: t.project_name,
          plannedForDate: t.start_date,
          dueDate: t.end_date,
          startDate: t.start_date,
          scheduledDate: t.scheduled_date,
          scheduledStartTime: t.scheduled_start_time,
          scheduledEndTime: t.scheduled_end_time,
          pctComplete: t.pct_complete,
          phase: t.phase,
          owner: t.owner,
        })),
        ...engTasksForUser.map((t) => ({
          id: t.id,
          taskType: "engineering" as const,
          title: t.title,
          status: t.status,
          priority: "Medium",
          projectName: t.projectName,
          plannedForDate: null,
          dueDate: null,
          startDate: null,
          scheduledDate: t.scheduledDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
          lifecyclePhase: t.lifecyclePhaseTag,
        })),
        ...(qcItemsForUser as any[]).map((t: any) => ({
          id: t.id,
          taskType: "quality" as const,
          title: t.item_name,
          status: t.qm_status || "not_started",
          priority: "Medium",
          projectName: t.project_name,
          plannedForDate: t.start_date,
          dueDate: t.end_date,
          startDate: t.start_date,
          scheduledDate: t.scheduled_date,
          scheduledStartTime: t.scheduled_start_time,
          scheduledEndTime: t.scheduled_end_time,
        })),
      ];

      res.json(combined);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/calendar/schedule-task", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const userName = (req.user as any).username;
      const { taskType, taskId, scheduledDate, scheduledStartTime, scheduledEndTime } = req.body;
      if (!taskType || !taskId) {
        return res.status(400).json({ error: "taskType and taskId required" });
      }

      const timeRegex = /^\d{2}:\d{2}$/;
      if (scheduledStartTime && !timeRegex.test(scheduledStartTime)) {
        return res.status(400).json({ error: "scheduledStartTime must be HH:mm format" });
      }
      if (scheduledEndTime && !timeRegex.test(scheduledEndTime)) {
        return res.status(400).json({ error: "scheduledEndTime must be HH:mm format" });
      }
      if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        return res.status(400).json({ error: "scheduledDate must be YYYY-MM-DD format" });
      }

      if (taskType === "mytool") {
        const [task] = await db.select().from(mytoolTasks).where(
          and(eq(mytoolTasks.id, taskId), eq(mytoolTasks.ownerUserId, userId))
        );
        if (!task) return res.status(404).json({ error: "Task not found or not owned by you" });

        await db.update(mytoolTasks)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(mytoolTasks.id, taskId));
      } else if (taskType === "operational") {
        const [task] = await db.select().from(workItems).where(and(eq(workItems.id, taskId), isNull(workItems.deletedAt)));
        if (!task) return res.status(404).json({ error: "Task not found" });

        const isOwner = task.ownerUserId === userId;
        // Check work_item_assignments for assignee relationship
        const assignmentCheck = await db.select().from(workItemAssignments).where(
          and(eq(workItemAssignments.workItemId, taskId), eq(workItemAssignments.userId, userId))
        );
        const isAssigned = assignmentCheck.length > 0;
        if (!isOwner && !isAssigned) {
          return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
        }

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "plan") {
        const taskResult = await db.select().from(workItems).where(eq(workItems.id, taskId));
        const [task] = taskResult;
        if (!task) return res.status(404).json({ error: "Plan task not found" });

        const isAssigned = task.ownerUserId === userId;
        if (!isAssigned) {
          const assignmentCheck = await db.select().from(workItemAssignments).where(
            and(eq(workItemAssignments.workItemId, taskId), eq(workItemAssignments.userId, userId))
          );
          if (assignmentCheck.length === 0) {
            return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
          }
        }

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "engineering") {
        // Schedule ENG tasks via work_items
        const [task] = await db.select().from(workItems).where(and(eq(workItems.id, taskId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
        if (!task) return res.status(404).json({ error: "Engineering task not found" });

        if (task.ownerUserId !== userId) {
          return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
        }

        await db.update(workItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, taskId));
      } else if (taskType === "quality") {
        const [task] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, taskId));
        if (!task) return res.status(404).json({ error: "Quality task not found" });

        if (task.assigneeUserId !== userId) {
          return res.status(403).json({ error: "You can only schedule tasks assigned to you" });
        }

        await db.update(qcItemInstance)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(qcItemInstance.id, taskId));
      } else if (taskType === "tr_register") {
        const [task] = await db.select().from(trItems).where(eq(trItems.id, taskId));
        if (!task) return res.status(404).json({ error: "Action item not found" });

        await db.update(trItems)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(trItems.id, taskId));
      } else if (taskType === "deliverable") {
        const [task] = await db.select().from(deliverables).where(eq(deliverables.id, taskId));
        if (!task) return res.status(404).json({ error: "Deliverable not found" });

        await db.update(deliverables)
          .set({
            scheduledDate: scheduledDate || null,
            scheduledStartTime: scheduledStartTime || null,
            scheduledEndTime: scheduledEndTime || null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, taskId));
      } else {
        return res.status(400).json({ error: "taskType must be 'mytool', 'operational', 'plan', 'engineering', 'quality', 'tr_register', or 'deliverable'" });
      }

      logAuditFromReq(req, {
        entityType: `${taskType}_task`,
        action: "calendar_schedule",
        entityId: String(taskId),
        changesJson: { scheduledDate, scheduledStartTime, scheduledEndTime },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - TASKS ====================

  app.get("/api/mytool/tasks", requireAuth, async (req, res) => {
    try {
      const userId = resolveMyToolUserId(req);

      const useCanonical = await isWorkItemsEnabled();
      if (useCanonical) {
        const canonicalTasks = await getWorkItemsAsMytoolTasks(userId);
        if (canonicalTasks.length > 0) {
          return res.json(canonicalTasks);
        }
      }

      const { date } = req.query;
      let tasks;
      if (date && typeof date === 'string') {
        tasks = await storage.getMytoolTasksByDate(userId, date);
      } else {
        tasks = await storage.getMytoolTasks(userId);
      }
      const enriched = await enrichMytoolTasks(userId, tasks);
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/tasks", requireAuth, async (req, res) => {
    const userId = (req.user as any).id;
    const rawRequestId = req.header("x-idempotency-key") || req.body?.clientRequestId;
    const requestId = typeof rawRequestId === "string" ? rawRequestId.trim() : "";
    const hasRequestId = requestId.length > 0;

    try {
      const validationErrors = validateTaskCreate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      const bucket = req.body.bucket || 'personal';
      if (bucket === 'project' && !req.body.projectName) {
        return sendError(res, badRequest("Project name is required when bucket is 'project'"));
      }
      if (bucket !== 'project' && req.body.projectName) {
        req.body.projectName = null;
      }
      if (req.body.status) req.body.status = toMytoolDbStatus(normalizeStatus(req.body.status));
      if (req.body.priority) req.body.priority = toMytoolDbPriority(normalizePriority(req.body.priority));

      if (hasRequestId) {
        const idempotencyResult = mytoolTaskIdempotencyStore.begin(userId, requestId);
        if (idempotencyResult.state === "duplicate_pending") {
          console.info("[mytool-task-create] request", { requestId, userId, result: "duplicate_pending" });
          return res.status(409).json({ error: "Duplicate create request in progress", requestId });
        }

        if (idempotencyResult.state === "duplicate_completed" && idempotencyResult.taskId) {
          const existingTask = await storage.getMytoolTask(idempotencyResult.taskId);
          if (existingTask && existingTask.ownerUserId === userId) {
            console.info("[mytool-task-create] request", { requestId, userId, result: "duplicate_completed", taskId: existingTask.id });
            return res.json({ ...existingTask, idempotentReplay: true, requestId });
          }
        }
      }

      const task = await storage.createMytoolTask({ ...req.body, bucket, ownerUserId: userId, taskType: req.body.taskType || "task" });
      if (hasRequestId) {
        mytoolTaskIdempotencyStore.complete(userId, requestId, task.id);
      }

      // Create entity_assignment for the personal task owner
      try {
        const [ownerUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
        await db.insert(entityAssignments).values({
          entityType: "personal_task",
          entityId: task.id,
          projectId: null,
          assignmentRole: "OWNER",
          assigneeType: "internal_user",
          assigneeId: userId,
          displayLabelSnapshot: ownerUser?.name || String(userId),
          active: true,
          assignedByUserId: userId,
          metadata: null,
          updatedAt: new Date(),
        }).onConflictDoNothing();
      } catch (assignErr: any) {
        console.warn("[mytool-task-create] Failed to create entity_assignment, task still created:", assignErr?.message);
      }

      console.info("[mytool-task-create] request", { requestId: hasRequestId ? requestId : null, userId, result: "created", taskId: task.id });
      logAuditFromReq(req, { entityType: "mytool_task", action: "create", entityId: String(task.id), changesJson: { description: "MyTool task created", title: req.body.title, bucket } });
      res.json(task);
    } catch (err: any) {
      if (hasRequestId) {
        mytoolTaskIdempotencyStore.fail(userId, requestId);
      }
      console.error("[mytool-task-create] request", { requestId: hasRequestId ? requestId : null, userId, result: "error", message: err?.message || "unknown_error" });
      sendError(res, err);
    }
  });

  app.patch("/api/mytool/tasks/:id", requireAuth, async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = (req.user as any).id;
      const validationErrors = validateTaskUpdate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (req.body.status) req.body.status = toMytoolDbStatus(normalizeStatus(req.body.status));
      if (req.body.priority) req.body.priority = toMytoolDbPriority(normalizePriority(req.body.priority));
      const existingTask = await storage.getMytoolTask(taskId);
      if (existingTask && existingTask.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }

      if (req.body.bucket !== undefined || req.body.projectName !== undefined) {
        const bucket = req.body.bucket || existingTask?.bucket || 'personal';
        const projectName = req.body.projectName !== undefined ? req.body.projectName : existingTask?.projectName;
        if (bucket === 'project' && !projectName) {
          return sendError(res, badRequest("Project name is required when bucket is 'project'"));
        }
        if (bucket !== 'project') {
          req.body.projectName = null;
        }
      }

      if (req.body.status === 'complete' && existingTask) {
        const dod = req.body.definitionOfDone || existingTask.definitionOfDone;
        if (!dod || !dod.trim()) {
          return sendError(res, validationError({ definitionOfDone: "Cannot mark task as done without a Definition of Done." }));
        }
      }

      const task = await storage.updateMytoolTask(taskId, req.body);
      if (req.body.status !== undefined) {
        await refreshDependentTaskStates(taskId);
      }

      if (
        (req.body.status === "complete" || req.body.status === "done") &&
        existingTask &&
        existingTask.isRecurring &&
        existingTask.recurrenceFrequency
      ) {
        const nextDate = computeNextRecurrenceDate(
          existingTask.plannedForDate || new Date().toISOString().slice(0, 10),
          existingTask.recurrenceFrequency,
          existingTask.recurrenceInterval || 1,
          existingTask.recurrenceDaysOfWeek
        );

        if (!existingTask.recurrenceEndDate || nextDate <= existingTask.recurrenceEndDate) {
          const recurrenceParentId = existingTask.recurrenceParentId || existingTask.id;
          const existingInstance = await db.select().from(mytoolTasks).where(and(
            eq(mytoolTasks.ownerUserId, userId),
            eq(mytoolTasks.recurrenceParentId, recurrenceParentId),
            eq(mytoolTasks.plannedForDate, nextDate),
            isNull(mytoolTasks.deletedAt),
          )).limit(1);

          if (!existingInstance.length) {
            await storage.createMytoolTask({
              ownerUserId: userId,
              title: existingTask.title,
              status: "planned",
              priority: existingTask.priority,
              plannedForDate: nextDate,
              dueAt: existingTask.dueAt ? computeNextDueDate(existingTask.dueAt, existingTask.recurrenceFrequency, existingTask.recurrenceInterval || 1) : null,
              notes: existingTask.notes,
              projectName: existingTask.projectName,
              tag: existingTask.tag,
              sortOrder: existingTask.sortOrder,
              isRecurring: true,
              recurrenceFrequency: existingTask.recurrenceFrequency,
              recurrenceInterval: existingTask.recurrenceInterval,
              recurrenceDaysOfWeek: existingTask.recurrenceDaysOfWeek,
              recurrenceEndDate: existingTask.recurrenceEndDate,
              recurrenceParentId,
              taskType: existingTask.taskType || "task",
            });
          }
        }
      }

      logAuditFromReq(req, { entityType: "mytool_task", action: "update", entityId: req.params.id, changesJson: { description: "MyTool task updated", changedFields: Object.keys(req.body) } });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/tasks/:id", requireAuth, async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = (req.user as any).id;
      const existingTask = await storage.getMytoolTask(taskId);
      if (existingTask && existingTask.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      await storage.deleteMytoolTask(taskId);
      logAuditFromReq(req, { entityType: "mytool_task", action: "delete", entityId: req.params.id, changesJson: { description: "MyTool task deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/mytool/tasks/:id/dependencies", requireAuth, async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const userId = (req.user as any).id;
      const task = await storage.getMytoolTask(taskId);
      if (task && task.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const deps = await db.select().from(mytoolTaskDependencies).where(or(eq(mytoolTaskDependencies.predecessorTaskId, taskId), eq(mytoolTaskDependencies.successorTaskId, taskId)));
      res.json(deps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/tasks/:id/dependencies", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const successorTaskId = Number(req.params.id);
      const predecessorTaskId = Number(req.body.predecessorTaskId);
      const dependencyType = req.body.dependencyType || "finish_to_start";
      // Verify user owns the successor task
      const task = await storage.getMytoolTask(successorTaskId);
      if (task && task.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const validationMessage = validateDependencyPair(predecessorTaskId, successorTaskId);
      if (validationMessage) return res.status(400).json({ error: validationMessage });

      const predecessorLinks = await db.select().from(mytoolTaskDependencies).where(eq(mytoolTaskDependencies.successorTaskId, predecessorTaskId));
      if (predecessorLinks.some((l) => l.predecessorTaskId === successorTaskId)) {
        return res.status(400).json({ error: "Circular dependency is not allowed" });
      }

      const [created] = await db.insert(mytoolTaskDependencies).values({ predecessorTaskId, successorTaskId, dependencyType }).onConflictDoNothing().returning();
      await refreshDependentTaskStates(predecessorTaskId);
      res.json(created || { predecessorTaskId, successorTaskId, dependencyType, duplicate: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/tasks/:id/dependencies/:dependencyId", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const taskId = Number(req.params.id);
      const task = await storage.getMytoolTask(taskId);
      if (task && task.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const dependencyId = Number(req.params.dependencyId);
      const [dep] = await db.select().from(mytoolTaskDependencies).where(eq(mytoolTaskDependencies.id, dependencyId));
      await db.delete(mytoolTaskDependencies).where(eq(mytoolTaskDependencies.id, dependencyId));
      if (dep) await refreshDependentTaskStates(dep.predecessorTaskId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/mytool/recurrence-templates", requireAuth, async (req, res) => {
    try {
      const userId = resolveMyToolUserId(req);
      const templates = await db.select().from(mytoolRecurrenceTemplates).where(eq(mytoolRecurrenceTemplates.ownerUserId, userId)).orderBy(desc(mytoolRecurrenceTemplates.updatedAt));
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/recurrence-templates", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const [template] = await db.insert(mytoolRecurrenceTemplates).values({ ...req.body, ownerUserId: userId }).returning();
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - TIMEBLOCKS ====================

  app.get("/api/mytool/timeblocks", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: "date query parameter required" });
      }
      const blocks = await storage.getMytoolTimeblocks(userId, date);
      res.json(blocks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/timeblocks", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const block = await storage.createMytoolTimeblock({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "create", entityId: String(block.id), changesJson: { description: "Timeblock created" } });
      res.json(block);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/mytool/timeblocks/:id", requireAuth, async (req, res) => {
    try {
      const block = await storage.updateMytoolTimeblock(parseInt(req.params.id), req.body);
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "update", entityId: req.params.id, changesJson: { description: "Timeblock updated" } });
      res.json(block);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/timeblocks/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMytoolTimeblock(parseInt(req.params.id));
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "delete", entityId: req.params.id, changesJson: { description: "Timeblock deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - DAILY REVIEWS ====================

  app.get("/api/mytool/daily-review", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: "date query parameter required" });
      }
      const review = await storage.getMytoolDailyReview(userId, date);
      res.json(review || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/daily-review", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const review = await storage.upsertMytoolDailyReview({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_daily_review", action: "update", changesJson: { description: "Daily review updated", date: req.body.date } });
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Company priorities and priority-link APIs are served by departments/exco-routes.ts.

  app.get("/api/mytool/escalated-priorities", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllOperationalTasks(),
      ]);

      const escalated: Array<{
        id: string;
        type: 'project' | 'task';
        title: string;
        projectName: string;
        escalationLevel: string;
        status: string | null;
        priority: string | null;
        dueDate: string | null;
        assignees: string[] | null;
      }> = [];

      for (const proj of allProjectInfo) {
        if (proj.escalationLevel === 'Highest') {
          escalated.push({
            id: `project-${proj.id}`,
            type: 'project',
            title: proj.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
            projectName: proj.projectName,
            escalationLevel: proj.escalationLevel,
            status: proj.phase || null,
            priority: null,
            dueDate: null,
            assignees: proj.pm ? [proj.pm] : null,
          });
        }
      }

      for (const task of allOpTasks) {
        if (task.escalationLevel === 'Highest') {
          escalated.push({
            id: `task-${task.id}`,
            type: 'task',
            title: task.title,
            projectName: task.projectName,
            escalationLevel: task.escalationLevel,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            assignees: task.assignees,
          });
        }
      }

      res.json(escalated);
    } catch (err: any) {
      const msg = err?.message || '';
      if (/relation.*does not exist|no such table|column.*does not exist/i.test(msg) || err?.code === '42P01' || err?.code === '42703') {
        console.warn("[escalated-priorities] Schema not ready, returning empty:", msg);
        return res.json([]);
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - USER PREFERENCES ====================

  app.get("/api/mytool/preferences", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const prefs = await storage.getMytoolUserPreferences(userId);
      res.json(prefs || { ownerUserId: userId, defaultView: 'today', workdayStartTime: '08:00', workdayEndTime: '17:00', showCompanyPriorities: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/preferences", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const prefs = await storage.upsertMytoolUserPreferences({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_preferences", action: "update", changesJson: { description: "User preferences updated" } });
      res.json(prefs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - EMAIL LINKS ====================

  app.get("/api/mytool/email-links", requireAuth, async (req, res) => {
    try {
      const { taskId, priorityId, operationalTaskId } = req.query;
      if (taskId) {
        const links = await storage.getEmailLinksByTask(parseInt(taskId as string));
        return res.json(links);
      }
      if (operationalTaskId) {
        const links = await storage.getEmailLinksByOperationalTask(parseInt(operationalTaskId as string));
        return res.json(links);
      }
      if (priorityId) {
        const links = await storage.getEmailLinksByPriority(parseInt(priorityId as string));
        return res.json(links);
      }
      res.json([]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/email-links", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any)?.id || null;
      const link = await storage.createEmailLink({ ...req.body, createdBy: userId });
      logAuditFromReq(req, { entityType: "email_link", action: "create", entityId: String(link.id), changesJson: { description: "Email link created" } });
      res.json(link);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/email-links/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteEmailLink(parseInt(req.params.id));
      logAuditFromReq(req, { entityType: "email_link", action: "delete", entityId: req.params.id, changesJson: { description: "Email link deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // My Tool - DoD Templates
  app.get("/api/mytool/dod-templates", requireAuth, async (req, res) => {
    try {
      const templates = await storage.getMytoolDodTemplates();
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/dod-templates", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const template = await storage.createMytoolDodTemplate({ ...req.body, createdBy: userId });
      logAuditFromReq(req, { entityType: "dod_template", action: "create", entityId: String(template.id), changesJson: { description: "DoD template created", title: req.body.title } });
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/dod-templates/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMytoolDodTemplate(parseInt(req.params.id));
      logAuditFromReq(req, { entityType: "dod_template", action: "delete", entityId: req.params.id, changesJson: { description: "DoD template deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Support Tickets
  app.post("/api/mytool/support-ticket", requireAuth, async (req, res) => {
    try {
      const { summary, stepsToReproduce, currentRoute, userAgent } = req.body;
      if (!summary || !stepsToReproduce) {
        return res.status(400).json({ error: "Summary and steps to reproduce are required" });
      }
      const correlationId = `ST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const ticket = await storage.createSupportTicket({
        userId: (req.user as any).id,
        summary,
        stepsToReproduce,
        currentRoute: currentRoute || null,
        userAgent: userAgent || null,
        correlationId,
        status: "open",
      });
      logAuditFromReq(req, { entityType: "support_ticket", action: "create", entityId: correlationId, changesJson: { description: "Support ticket created", summary } });
      res.json(ticket);
    } catch (error: any) {
      console.error("Error creating support ticket:", error);
      res.status(500).json({ error: "Failed to create support ticket" });
    }
  });

  // Support tickets listing is admin-only (cross-user administrative view)
  app.get("/api/mytool/support-tickets", requireAuth, requireAdmin, async (req, res) => {
    try {
      const tickets = await storage.getSupportTickets();
      res.json(tickets);
    } catch (error: any) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ error: "Failed to fetch support tickets" });
    }
  });

  app.post("/api/error-log", requireAuth, async (req, res) => {
    try {
      const { route, action, errorMessage, errorStack, payloadShape } = req.body;
      const correlationId = `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await storage.createErrorLog({
        userId: (req.user as any).id,
        route: route || null,
        action: action || null,
        correlationId,
        errorMessage: errorMessage || "Unknown error",
        errorStack: errorStack || null,
        payloadShape: payloadShape || null,
      });
      res.json({ correlationId });
    } catch (error: any) {
      console.error("Error logging error:", error);
      res.status(500).json({ error: "Failed to log error" });
    }
  });

  // ─── Outlook Integration (Replit Connector) ───
  const outlook = await import("./outlook");

  app.get("/api/outlook/status", requireAuth, async (req, res) => {
    try {
      const status = await outlook.getConnectionStatus();
      res.json(status);
    } catch (err: any) {
      res.json({ configured: false, connected: false });
    }
  });

  app.post("/api/outlook/refresh", requireAuth, async (req, res) => {
    try {
      outlook.clearCachedToken();
      const status = await outlook.getConnectionStatus();
      res.json(status);
    } catch (err: any) {
      res.json({ configured: false, connected: false, error: err.message });
    }
  });

  app.get("/api/ms-integration/status", requireAuth, async (req, res) => {
    try {
      const outlookStatus = await outlook.getConnectionStatus();

      let config: Record<string, any> = {};
      try {
        const rows = await db.execute(sql`SELECT config_key, config_value FROM ms_integration_settings`);
        for (const row of rows.rows) {
          config[row.config_key as string] = row.config_value;
        }
      } catch {}

      const featureFlags = config.feature_flags || {};
      const spConfig = config.sharepoint_project_docs || {};
      const teamsConfig = config.teams_config || {};

      res.json({
        outlook: {
          configured: outlookStatus.configured,
          connected: outlookStatus.connected,
          email: outlookStatus.email || null,
        },
        sharepoint: {
          enabled: !!featureFlags.feature_ms_sharepoint_docs,
          connected: spConfig.connectionStatus === "connected",
          siteName: spConfig.siteName || null,
          driveName: spConfig.driveName || null,
        },
        teams: {
          enabled: !!featureFlags.feature_ms_teams,
          configured: !!(teamsConfig.unansweredThresholdHours || teamsConfig.tags?.length),
          tags: teamsConfig.tags || [],
        },
        user: {
          id: (req.user as any)?.id,
          name: (req.user as any)?.name,
          role: (req.user as any)?.role,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  async function getUserSsoToken(req: any): Promise<string | null> {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return null;
    try {
      const { getSsoTokenForUser } = await import("./ms-account-service");
      return await getSsoTokenForUser(userId);
    } catch {
      return null;
    }
  }

  async function userHasMsAccount(req: any): Promise<boolean> {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return false;
    try {
      const { getMsAccountForUser } = await import("./ms-account-service");
      const account = await getMsAccountForUser(userId);
      return !!(account && account.status === "active");
    } catch {
      return false;
    }
  }

  app.get("/api/outlook/events", requireAuth, async (req, res) => {
    try {
      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ error: "start and end query params required (YYYY-MM-DD)" });
      }
      const userToken = await getUserSsoToken(req);
      let events: any[] = [];
      if (userToken) {
        try {
          events = await outlook.getCalendarEvents(start as string, end as string, userToken);
        } catch (graphErr: any) {
          console.log("[Outlook] Graph API call failed with user token:", graphErr.message);
        }
      } else {
        try {
          events = await outlook.getCalendarEvents(start as string, end as string);
        } catch (fallbackErr: any) {
          console.log("[Outlook] Connector fallback failed:", fallbackErr.message);
        }
      }
      if (events.length === 0) {
        const userId = (req.user as any)?.id;
        if (userId) {
          try {
            const { db } = await import("./db");
            const { msObjects } = await import("@shared/schema");
            const { and, eq, gte, lte } = await import("drizzle-orm");
            const startDate = `${start}T00:00:00`;
            const endDate = `${end}T23:59:59`;
            const synced = await db.select().from(msObjects).where(
              and(
                eq(msObjects.userId, userId),
                eq(msObjects.type, "event"),
                gte(msObjects.receivedOrStartDatetime, startDate),
                lte(msObjects.receivedOrStartDatetime, endDate)
              )
            );
            events = synced.map((s: any) => {
              const meta = s.metadata || {};
              return {
                id: s.msId || String(s.id),
                subject: s.subjectOrTitle || "No Subject",
                start: s.receivedOrStartDatetime,
                end: s.endDatetime || s.receivedOrStartDatetime,
                isAllDay: meta.isAllDay || false,
                location: meta.location || null,
                organizer: s.senderOrOrganizer || null,
                showAs: meta.showAs || "busy",
                isCancelled: false,
                isRecurring: meta.isRecurring || false,
                source: "synced",
                webLink: s.webLink,
              };
            });
          } catch (dbErr: any) {
            console.log("[Outlook] DB fallback failed:", dbErr.message);
          }
        }
      }
      res.json(events);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      console.error("[Outlook] Events error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/events", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { date, startTime, endTime, label, idempotencyKey } = req.body;
      if (!date || !startTime || !endTime || !label) {
        return res.status(400).json({ error: "date, startTime, endTime, label are required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to create calendar events." });
      }
      const eventId = await outlook.createOutlookEvent({
        date, startTime, endTime, label,
        idempotencyKey: idempotencyKey || `tb-${Date.now()}`,
      }, userToken);
      logAuditFromReq(req, { entityType: "outlook_event", action: "create", entityId: eventId, changesJson: { description: "Outlook calendar event created", label, date } });
      res.json({ eventId });
    } catch (err: any) {
      console.error("[Outlook] Create event error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/outlook/events/:eventId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { calendarId, date, startTime, endTime, label } = req.body;
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to update calendar events." });
      }
      await outlook.updateOutlookEvent(req.params.eventId, calendarId || null, {
        date, startTime, endTime, label,
      }, userToken);
      logAuditFromReq(req, { entityType: "outlook_event", action: "update", entityId: req.params.eventId, changesJson: { description: "Outlook event updated", label } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Update event error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/outlook/events/:eventId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { calendarId } = req.query;
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to delete calendar events." });
      }
      await outlook.deleteOutlookEvent(req.params.eventId, (calendarId as string) || null, userToken);
      logAuditFromReq(req, { entityType: "outlook_event", action: "delete", entityId: req.params.eventId, changesJson: { description: "Outlook event deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Delete event error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/outlook/messages", requireAuth, async (req, res) => {
    try {
      const { search, top, skip, folder } = req.query;
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const messages = await outlook.listMessages({
        search: search ? String(search) : undefined,
        top: top ? parseInt(String(top)) : 20,
        skip: skip ? parseInt(String(skip)) : 0,
        folder: folder ? String(folder) : "inbox",
      }, userToken);
      res.json(messages);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available") || err.message?.includes("not configured")) {
        return res.json([]);
      }
      console.error("[Outlook] Messages error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/outlook/messages/:id", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required to view emails. Please sign in with Microsoft." });
      }
      const msg = await outlook.getMessageDetail(req.params.id, userToken);
      res.json(msg);
    } catch (err: any) {
      console.error("[Outlook] Message detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/email-to-task", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { getFeatureFlag } = await import("./lib/feature-flags");
      const enabled = await getFeatureFlag("ms_create_action", false);
      if (!enabled) {
        return res.status(404).json({ error: "Microsoft create actions are not enabled" });
      }

      const userId = (req.user as any).id;
      const {
        sourceType,
        sourceRef,
        webLink,
        subject,
        sender,
        receivedAt,
        snippet,
        createType,
        category,
        projectBehavior,
        projectName,
        assigneeUserId,
        priority,
        dueDate,
        description,
        suggestions,
        chosenValues,
        overrideReasons,
      } = req.body || {};

      const normalizedSourceType = sourceType === "teams" || sourceType === "sharepoint" || sourceType === "email" ? sourceType : null;
      const normalizedCreateType = createType === "task" || createType === "action" ? createType : null;
      const normalizedProjectBehavior = projectBehavior === "accept_suggested" || projectBehavior === "choose_other" || projectBehavior === "leave_unlinked" ? projectBehavior : null;
      if (!normalizedSourceType || !normalizedCreateType || !normalizedProjectBehavior) {
        return res.status(400).json({ error: "sourceType, createType, and projectBehavior are required" });
      }
      if (!sourceRef || !subject || !category) {
        return res.status(400).json({ error: "sourceRef, subject, and category are required" });
      }
      if ((normalizedProjectBehavior === "accept_suggested" || normalizedProjectBehavior === "choose_other") && !projectName) {
        return res.status(400).json({ error: "projectName is required for linked items" });
      }
      if (normalizedCreateType === "task" && normalizedProjectBehavior === "leave_unlinked") {
        return res.status(400).json({ error: "Unlinked creation is not supported for task items in the canonical task model. Choose action or link a project." });
      }

      const suggested = suggestions || {};
      const chosen = chosenValues || {
        projectName: projectName || null,
        assigneeUserId: assigneeUserId || null,
        dueDate: dueDate || null,
        title: subject,
        summary: description || snippet || null,
      };
      const reasons = overrideReasons || {};

      const overrideFields = ["projectName", "assigneeUserId", "dueDate", "title", "summary"] as const;
      for (const field of overrideFields) {
        const suggestedValue = suggested[field] ?? null;
        const chosenValue = chosen[field] ?? null;
        if (suggestedValue !== null && chosenValue !== suggestedValue) {
          const reason = reasons[field];
          if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: `Override reason required for ${field}` });
          }
          logAuditFromReq(req, {
            entityType: "ms_create_action",
            action: "suggestion_overridden",
            entityId: `${normalizedSourceType}:${sourceRef}`,
            changesJson: { field, suggestedValue, chosenValue, reason: String(reason).trim() },
          });
          logAuditFromReq(req, {
            entityType: "ms_create_action",
            action: "override_reason_captured",
            entityId: `${normalizedSourceType}:${sourceRef}`,
            changesJson: { field, reason: String(reason).trim() },
          });
        } else if (suggestedValue !== null) {
          logAuditFromReq(req, {
            entityType: "ms_create_action",
            action: "suggestion_accepted",
            entityId: `${normalizedSourceType}:${sourceRef}`,
            changesJson: { field, value: chosenValue },
          });
        }
      }

      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "source_item_opened",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { sourceType: normalizedSourceType, sourceRef, webLink: webLink || null },
      });
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_clicked",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { createType: normalizedCreateType, category, projectBehavior: normalizedProjectBehavior },
      });
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "suggestions_presented",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { suggestions: suggested, chosenValues: chosen },
      });

      const existing = await db.execute(sql`
        SELECT id, created_item_type, created_item_id
        FROM ms_create_item_links
        WHERE source_type = ${normalizedSourceType}
          AND source_ref = ${sourceRef}
          AND created_item_type = ${normalizedCreateType}
        LIMIT 1
      `).then((r: any) => r.rows || r);
      if (existing?.length) {
        return res.status(409).json({
          error: "Duplicate create prevented",
          existing: existing[0],
        });
      }

      let createdItemType = normalizedCreateType;
      let createdItemId: number | null = null;

      if (normalizedCreateType === "task") {
        const opTask = await storage.createOperationalTask({
          projectName: String(projectName),
          title: String(chosen.title || subject),
          description: description || String(chosen.summary || snippet || ""),
          status: "TO DO",
          priority: priority || "Med",
          ownerUserId: assigneeUserId ? parseInt(String(assigneeUserId)) : null,
          requesterUserId: userId,
          dueDate: dueDate || null,
          sortOrder: 0,
          externalSource: normalizedSourceType,
          externalTaskId: sourceRef,
          createdBy: userId,
          domain: "BOTH",
          percentComplete: 0,
          taskTypeTag: category,
        });
        createdItemId = opTask.id;
      } else {
        const task = await storage.createMytoolTask({
          ownerUserId: assigneeUserId ? parseInt(String(assigneeUserId)) : userId,
          title: String(chosen.title || subject),
          status: "inbox",
          priority: "normal",
          notes: description || String(chosen.summary || snippet || ""),
          sortOrder: 0,
          isRecurring: false,
          bucket: projectName ? "project" : "personal",
          projectName: projectName || null,
          tag: category,
          sourceEmailId: normalizedSourceType === "email" ? sourceRef : null,
          sourceEmailSubject: normalizedSourceType === "email" ? subject : null,
          dueAt: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
        });
        createdItemId = task.id;
      }

      const [trace] = await db.execute(sql`
        INSERT INTO ms_create_item_links (
          source_type, source_ref, source_deep_link, source_title, source_sender_or_author,
          created_item_type, created_item_id, category, project_behavior,
          suggested_values, chosen_values, override_reasons, created_by
        ) VALUES (
          ${normalizedSourceType}, ${sourceRef}, ${webLink || null}, ${subject}, ${sender || null},
          ${createdItemType}, ${createdItemId}, ${category}, ${normalizedProjectBehavior},
          ${JSON.stringify(suggested)}, ${JSON.stringify(chosen)}, ${JSON.stringify(reasons)}, ${userId}
        ) RETURNING *
      `).then((r: any) => r.rows || r);

      if (normalizedSourceType === "email") {
        await storage.createEmailLink({
          subject,
          sender: sender || null,
          emailDate: receivedAt ? new Date(receivedAt).toISOString().slice(0, 10) : null,
          snippet: snippet || null,
          outlookMessageId: sourceRef,
          webLink: webLink || null,
          linkedTaskId: normalizedCreateType === "action" ? createdItemId : null,
          linkedOperationalTaskId: normalizedCreateType === "task" ? createdItemId : null,
          linkedPriorityId: null,
          createdBy: userId,
        });
      }

      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_confirmed",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { createType: normalizedCreateType, category, createdItemId },
      });
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_succeeded",
        entityId: `${normalizedSourceType}:${sourceRef}`,
        changesJson: { createdItemType, createdItemId, projectName: projectName || null },
      });

      res.json({
        createdItem: { type: createdItemType, id: createdItemId },
        trace,
      });
    } catch (err: any) {
      logAuditFromReq(req, {
        entityType: "ms_create_action",
        action: "create_failed",
        changesJson: { error: err?.message || "Unknown error" },
      });
      console.error("[Outlook] Email-to-task error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/send-approval", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { to, subject, approvalTitle, approvalDescription, approveUrl, rejectUrl } = req.body;
      if (!to || !subject || !approvalTitle) {
        return res.status(400).json({ error: "to, subject, and approvalTitle are required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.sendApprovalEmail({
        to, subject, approvalTitle,
        approvalDescription: approvalDescription || "",
        approveUrl: approveUrl || "#",
        rejectUrl: rejectUrl || "#",
      }, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "send_approval", changesJson: { description: "Approval email sent", to, subject } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Send approval error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/outlook/folders", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const folders = await outlook.listMailFolders(userToken);
      res.json(folders);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available") || err.message?.includes("not configured")) {
        return res.json([]);
      }
      console.error("[Outlook] Folders error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/joined", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.userId;
      let ssoToken: string | null = null;
      if (userId) {
        try {
          const { getSsoTokenForUser } = await import("./ms-account-service");
          ssoToken = await getSsoTokenForUser(userId);
        } catch {}
      }
      if (!ssoToken) {
        return res.json({ data: [], ssoRequired: true, message: "Sign in with Microsoft to access Teams data" });
      }
      const teams = await outlook.getJoinedTeams(ssoToken);
      const result: any[] = [];
      for (const team of teams) {
        const channels = await outlook.getTeamChannels(team.id, ssoToken);
        result.push({ ...team, channels });
      }
      res.json(result);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      if (err.message?.includes("403")) {
        return res.json({ data: [], ssoRequired: true, message: "Teams session expired — please sign in with Microsoft again" });
      }
      console.error("[Teams Graph] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/chats", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.userId;
      let ssoToken: string | null = null;
      if (userId) {
        try {
          const { getSsoTokenForUser } = await import("./ms-account-service");
          ssoToken = await getSsoTokenForUser(userId);
        } catch {}
      }
      if (!ssoToken) {
        return res.json({ data: [], ssoRequired: true, message: "Sign in with Microsoft to access Teams chats" });
      }
      const chats = await outlook.getMyChats(30, ssoToken);
      res.json(chats);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      if (err.message?.includes("403")) {
        return res.json({ data: [], ssoRequired: true, message: "Teams session expired — please sign in with Microsoft again" });
      }
      console.error("[Teams Graph] Chats error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/chats/:chatId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.json({ messages: [], ssoRequired: true });
      }
      const messages = await outlook.getChatMessages(req.params.chatId, 50, ssoToken);
      res.json({ messages });
    } catch (err: any) {
      if (err.message?.includes("403")) {
        return res.json({ messages: [], ssoRequired: true });
      }
      console.error("[Teams] Chat messages error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ms-teams/channels/:teamId/:channelId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.json({ messages: [], ssoRequired: true });
      }
      const messages = await outlook.getChannelMessages(req.params.teamId, req.params.channelId, 50, ssoToken);
      res.json({ messages });
    } catch (err: any) {
      if (err.message?.includes("403")) {
        return res.json({ messages: [], ssoRequired: true });
      }
      console.error("[Teams] Channel messages error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-teams/chats/:chatId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.status(401).json({ error: "Microsoft sign-in required" });
      }
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }
      const result = await outlook.sendChatMessage(req.params.chatId, content.trim(), ssoToken);
      logAuditFromReq(req, { entityType: "ms_teams_chat", entityId: req.params.chatId, action: "send_message" });
      res.json({ success: true, message: result });
    } catch (err: any) {
      console.error("[Teams] Send chat message error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ms-teams/channels/:teamId/:channelId/messages", requireAuth, async (req, res) => {
    try {
      const ssoToken = await getUserSsoToken(req);
      if (!ssoToken) {
        return res.status(401).json({ error: "Microsoft sign-in required" });
      }
      const { content } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }
      const result = await outlook.sendChannelMessage(req.params.teamId, req.params.channelId, content.trim(), ssoToken);
      logAuditFromReq(req, { entityType: "ms_teams_channel", entityId: `${req.params.teamId}/${req.params.channelId}`, action: "send_message" });
      res.json({ success: true, message: result });
    } catch (err: any) {
      console.error("[Teams] Send channel message error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sharepoint/discover-sites", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const sites = await outlook.discoverSharePointSites(userToken);
      res.json(sites);
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json([]);
      }
      console.error("[SharePoint] Discover sites error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sharepoint/site-drives/:siteId", requireAuth, async (req, res) => {
    try {
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.json([]);
      }
      const drives = await outlook.getSiteDrives(req.params.siteId, userToken);
      res.json(drives);
    } catch (err: any) {
      console.error("[SharePoint] Site drives error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/send", requireAuth, async (req, res) => {
    try {
      const { to, cc, subject, body, bodyType } = req.body;
      if (!to || !Array.isArray(to) || to.length === 0 || !subject) {
        return res.status(400).json({ error: "to (array) and subject are required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.sendMail({ to, cc: cc || [], subject, body: body || "", bodyType: bodyType || "Text" }, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "send", changesJson: { description: "Email sent", to, subject } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Send mail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/messages/:id/reply", requireAuth, async (req, res) => {
    try {
      const { comment, replyAll } = req.body;
      if (!comment) {
        return res.status(400).json({ error: "comment is required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.replyToMessage(req.params.id, comment, !!replyAll, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "reply", entityId: req.params.id, changesJson: { description: "Email reply sent", replyAll: !!replyAll } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Reply error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/outlook/messages/:id/forward", requireAuth, async (req, res) => {
    try {
      const { comment, to } = req.body;
      if (!to || !Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ error: "to (array) is required" });
      }
      const userToken = await getUserSsoToken(req);
      if (!userToken) {
        return res.status(401).json({ error: "Microsoft sign-in required. Please sign in with Microsoft." });
      }
      await outlook.forwardMessage(req.params.id, comment || "", to, userToken);
      logAuditFromReq(req, { entityType: "outlook_email", action: "forward", entityId: req.params.id, changesJson: { description: "Email forwarded", to } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Outlook] Forward error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== SHAREPOINT IMPORT ROUTES ====================

  const { testConnection, isSharePointConfigured, browseFolders } = await import("./sharepoint");
  const { runFullImport, retryFailedImports, importSingleFile, createSnapshotFromUpload } = await import("./importPipeline");

  // Admin: Get SP settings
  app.get("/api/admin/sp-settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const settings = await storage.getSpSettings();
      res.json(settings || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Save SP settings
  app.post("/api/admin/sp-settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { siteId, driveId, folderItemId, folderPath, intervalMinutes, enabled } = req.body;
      if (!siteId || !driveId) {
        return res.status(400).json({ error: "siteId and driveId are required" });
      }
      const settings = await storage.upsertSpSettings({
        siteId,
        driveId,
        folderItemId: folderItemId || null,
        folderPath: folderPath || null,
        intervalMinutes: intervalMinutes || 30,
        enabled: enabled ?? false,
        updatedBy: (req.user as any)?.id || null,
      });
      logAuditFromReq(req, { entityType: "admin", action: "sp_settings_update", changesJson: { description: "SharePoint settings updated", siteId, driveId, enabled } });
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Test SP connection
  app.post("/api/admin/sp-settings/test", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { siteId, driveId } = req.body;
      if (!siteId || !driveId) {
        return res.status(400).json({ error: "siteId and driveId are required" });
      }
      const result = await testConnection(siteId, driveId);
      logAuditFromReq(req, { entityType: "sp_settings", action: "test_connection", changesJson: { siteId, driveId } });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Browse SharePoint folders
  app.get("/api/admin/sp-browse", requireAuth, requireAdmin, async (req, res) => {
    try {
      const driveId = req.query.driveId as string;
      const folderId = req.query.folderId as string | undefined;
      if (!driveId) {
        return res.status(400).json({ error: "driveId is required" });
      }
      const items = await browseFolders(driveId, folderId || undefined);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Import single file from SharePoint
  app.post("/api/admin/import/single", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { driveId, siteId, itemId } = req.body;
      if (!driveId || !siteId || !itemId) {
        return res.status(400).json({ error: "driveId, siteId, and itemId are required" });
      }
      const user = req.user as any;
      const result = await importSingleFile(driveId, siteId, itemId, user?.email || user?.name || "admin");
      logAuditFromReq(req, { entityType: "admin", action: "import_single", changesJson: { description: "Single file imported from SharePoint", itemId } });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Run import now
  app.post("/api/admin/import/run", requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const result = await runFullImport("manual", user?.email || user?.name || "admin");
      logAuditFromReq(req, { entityType: "admin", action: "import_run", changesJson: { description: "Full import triggered manually" } });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Retry failed imports
  app.post("/api/admin/import/retry-failed", requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const result = await retryFailedImports(user?.email || user?.name || "admin");
      logAuditFromReq(req, { entityType: "admin", action: "import_retry", changesJson: { description: "Failed imports retried" } });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: List import runs
  app.get("/api/admin/import/runs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const runs = await storage.getAllImportRuns();
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get single import run + ledger entries
  app.get("/api/admin/import/runs/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const runId = parseInt(req.params.id);
      const run = await storage.getImportRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      const entries = await storage.getAllChangeLedger({ runId });
      res.json({ run, entries });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TRIAGE RULES CRUD ====================

  app.get("/api/mytool/triage-rules", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const rules = await db.select().from(triageRulesTable).where(eq(triageRulesTable.ownerUserId, userId));
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/triage-rules", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { ruleType, value } = req.body;
      if (!ruleType || !value) return res.status(400).json({ error: "ruleType and value required" });
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const [rule] = await db.insert(triageRulesTable).values({
        ownerUserId: userId,
        ruleType,
        value: value.trim(),
        enabled: true,
      }).returning();
      logAuditFromReq(req, { entityType: "triage_rule", action: "create", entityId: String(rule.id), changesJson: { description: "Triage rule created", ruleType, value } });
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/mytool/triage-rules/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ruleId = parseInt(req.params.id);
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const [existing] = await db.select().from(triageRulesTable).where(eq(triageRulesTable.id, ruleId)).limit(1);
      if (existing && existing.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      const updates: any = {};
      if (req.body.value !== undefined) updates.value = req.body.value.trim();
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      const [rule] = await db.update(triageRulesTable).set(updates).where(eq(triageRulesTable.id, ruleId)).returning();
      logAuditFromReq(req, { entityType: "triage_rule", action: "update", entityId: String(ruleId), changesJson: { description: "Triage rule updated" } });
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/triage-rules/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ruleId = parseInt(req.params.id);
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const [existing] = await db.select().from(triageRulesTable).where(eq(triageRulesTable.id, ruleId)).limit(1);
      if (existing && existing.ownerUserId !== userId && !isMyToolOversightRole(req)) {
        return res.status(403).json({ error: "Insufficient permissions to perform data imports" });
      }
      await db.delete(triageRulesTable).where(eq(triageRulesTable.id, ruleId));
      logAuditFromReq(req, { entityType: "triage_rule", action: "delete", entityId: String(ruleId), changesJson: { description: "Triage rule deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TRIAGE INBOX ====================

  app.get("/api/mytool/triage-inbox", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const outlook = await import("./outlook");
      if (!outlook.isOutlookConfigured()) {
        return res.json({ flagged: [], keywordMatches: [], senderMatches: [], rules: [] });
      }

      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const rules = await db.select().from(triageRulesTable)
        .where(and(eq(triageRulesTable.ownerUserId, userId), eq(triageRulesTable.enabled, true)));

      const keywords = rules.filter(r => r.ruleType === 'keyword').map(r => r.value.toLowerCase());
      const senders = rules.filter(r => r.ruleType === 'sender').map(r => r.value.toLowerCase());
      const domains = rules.filter(r => r.ruleType === 'domain').map(r => r.value.toLowerCase());

      let flagged: any[] = [];
      try {
        flagged = await outlook.listFlaggedMessages(30);
      } catch {}

      let recentEmails: any[] = [];
      try {
        recentEmails = await outlook.listMessages({ top: 50 });
      } catch {}

      const keywordMatches: any[] = [];
      const senderMatches: any[] = [];
      const flaggedIds = new Set(flagged.map((e: any) => e.id));

      for (const email of recentEmails) {
        if (flaggedIds.has(email.id)) continue;
        const subjectLower = (email.subject || "").toLowerCase();
        const snippetLower = (email.snippet || "").toLowerCase();
        const senderEmailLower = (email.senderEmail || "").toLowerCase();

        const matchedKeyword = keywords.find(kw => subjectLower.includes(kw) || snippetLower.includes(kw));
        if (matchedKeyword) {
          keywordMatches.push({ ...email, matchedRule: matchedKeyword, matchType: 'keyword' });
          continue;
        }

        const matchedSender = senders.find(s => senderEmailLower === s || (email.sender || "").toLowerCase() === s);
        if (matchedSender) {
          senderMatches.push({ ...email, matchedRule: matchedSender, matchType: 'sender' });
          continue;
        }

        const matchedDomain = domains.find(d => senderEmailLower.endsWith("@" + d) || senderEmailLower.endsWith("." + d));
        if (matchedDomain) {
          senderMatches.push({ ...email, matchedRule: matchedDomain, matchType: 'domain' });
        }
      }

      res.json({ flagged, keywordMatches, senderMatches, rules });
    } catch (err: any) {
      if (err.message?.includes("not connected") || err.message?.includes("not available")) {
        return res.json({ flagged: [], keywordMatches: [], senderMatches: [], rules: [] });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== UNCLASSIFIED TASKS ====================

  app.get("/api/mytool/unclassified-tasks", requireAuth, async (req, res) => {
    try {
      const userId = resolveMyToolUserId(req);
      const { mytoolTasks: mytoolTasksTable } = await import("@shared/schema");
      const tasks = await db.select().from(mytoolTasksTable)
        .where(
          and(
            eq(mytoolTasksTable.ownerUserId, userId),
            or(
              isNull(mytoolTasksTable.bucket),
              and(eq(mytoolTasksTable.bucket, 'project'), isNull(mytoolTasksTable.projectName))
            )
          )
        );
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  registerFeedbackRoutes(app);
  registerUserFolderRoutes(app);

  return httpServer;
}

function computeNextDueDate(currentDue: Date, frequency: string, interval: number): Date {
  const d = new Date(currentDue);
  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7 * interval);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + interval);
      break;
  }
  return d;
}

function generateCSV(data: any[], columns: string[]): string {
  if (data.length === 0) {
    return columns.join(",") + "\n";
  }
  
  const header = columns.join(",");
  const rows = data.map(item => 
    columns.map(col => {
      const value = item[col];
      if (value === null || value === undefined) return "";
      const stringValue = String(value);
      if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(",")
  );
  
  return [header, ...rows].join("\n");
}


// ========== FEEDBACK / BUG REPORT SYSTEM ==========

import { feedbackTickets, userProjectFolders } from "@shared/schema";

function registerFeedbackRoutes(app: Express) {
  app.get("/api/feedback", requireAuth, async (req, res) => {
    try {
      const tickets = await db.select().from(feedbackTickets).where(isNull(feedbackTickets.deletedAt)).orderBy(desc(feedbackTickets.createdAt));
      res.json(tickets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/feedback", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { type, title, description, priority } = req.body;
      if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
      }
      const [ticket] = await db.insert(feedbackTickets).values({
        type: type || "bug",
        title,
        description,
        priority: priority || "medium",
        submittedBy: user.id,
        submittedByName: user.name || user.email || "Unknown",
      }).returning();
      logAuditFromReq(req, { entityType: "feedback", action: "create", entityId: String(ticket.id), changesJson: { description: "Feedback ticket created", title, type: type || "bug" } });
      res.json(ticket);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/feedback/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, adminNotes, priority } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (status) updates.status = status;
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;
      if (priority) updates.priority = priority;
      const [updated] = await db.update(feedbackTickets).set(updates).where(eq(feedbackTickets.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Ticket not found" });
      logAuditFromReq(req, { entityType: "feedback", action: "update", entityId: String(id), changesJson: { description: "Feedback ticket updated", status, priority } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/feedback/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(feedbackTickets).where(eq(feedbackTickets.id, id));
      logAuditFromReq(req, { entityType: "feedback", action: "delete", entityId: String(id), changesJson: { description: "Feedback ticket deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}


function registerUserFolderRoutes(app: Express) {
  app.get("/api/user-project-folder/:projectName", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const projectName = decodeURIComponent(req.params.projectName);

      const [folder] = await db.select()
        .from(userProjectFolders)
        .where(and(
          eq(userProjectFolders.userId, userId),
          eq(userProjectFolders.projectName, projectName)
        ));

      res.json(folder || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/user-project-folder/:projectName", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const projectName = decodeURIComponent(req.params.projectName);
      const { folderName, folderPath } = req.body;

      if (!folderName) return res.status(400).json({ error: "folderName is required" });

      const [existing] = await db.select()
        .from(userProjectFolders)
        .where(and(
          eq(userProjectFolders.userId, userId),
          eq(userProjectFolders.projectName, projectName)
        ));

      if (existing) {
        const [updated] = await db.update(userProjectFolders)
          .set({ folderName, folderPath: folderPath || null, updatedAt: new Date() })
          .where(eq(userProjectFolders.id, existing.id))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(userProjectFolders)
        .values({ userId, projectName, folderName, folderPath: folderPath || null })
        .returning();
      logAuditFromReq(req, { entityType: "user_project_folder", action: "upsert", projectName, changesJson: { folderName } });
      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/user-project-folder/:projectName", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const projectName = decodeURIComponent(req.params.projectName);

      await db.delete(userProjectFolders)
        .where(and(
          eq(userProjectFolders.userId, userId),
          eq(userProjectFolders.projectName, projectName)
        ));
      logAuditFromReq(req, { entityType: "user_project_folder", action: "delete", projectName });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, err);
  });
}
