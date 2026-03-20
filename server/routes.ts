// @ts-nocheck
import { toCanonicalEngineeringStageStatus } from "@shared/status-logic";
import { assertTaskWorkflowTransition, buildTaskWorkflowContext, TaskWorkflowGuardError } from "./lib/task-workflow-guard";
import { softCloseByProjectName, addTemporalColumns } from "./lib/temporal-helpers";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { parseTrackerFile, applyFontColors } from "./excelParser";
import { projectInfo, normalizedCostLines, normalizedRevenueLines, normalizedExecutionPhases, smartImportRuns, users, notifications, notificationThrottle, mytoolTasks, mytoolTaskDependencies, mytoolRecurrenceTemplates, mytoolRecurrenceInstances, qcItemInstance, qcChecklist, qcTemplateItem, planEditNotifications, workItems, workItemAssignments, clients, projectClientHistory, trItems, deliverables, uploadMetadata, cashflowPoints, financeRevenueMonthly, financeCosMonthly, manualEditFlags, entityAssignments, programExpense } from "@shared/schema";
import { inlineEdit } from "./lib/inline-edit-helper";
import { db } from "./db";
import { safeLegacyQuery } from "./legacy-table-guard";
import { eq, and, or, sql, isNull, asc, desc, inArray } from "drizzle-orm";
import { runSmartImportPreview } from "./lib/import/index";
import { z } from "zod";
import { format } from "date-fns";
import { requireAuth as sharedRequireAuth } from "./auth-context";
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
import { computeNextRecurrenceDate, computeMilestoneProgress, isOverdue, shouldBlockTask, validateDependencyPair } from "./lib/mytool-work-engine";
import { computeScheduleRag, computeCostRag, computeQualityRag, computeOverallRag, DEFAULT_RAG_THRESHOLDS } from "@shared/kpi-definitions";

function isDateConfirmedCheck(confirmed: boolean | null | undefined, fontColor: string | null | undefined): boolean {
  if (fontColor === 'red') return false;
  if (fontColor === 'black') return true;
  if (confirmed === true) return true;
  return false;
}

function isCosRealisedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasInvDate = !!(exp.expenseInvoicedDate && String(exp.expenseInvoicedDate).trim());
  return hasInvoice && hasInvDate;
}

function isCashflowConfirmedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  const payDateConfirmed = isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);
  return payDateConfirmed;
}

async function getMergedExpensesAndInflows(expenses: any[], inflows: any[]) {
  return { expenses, inflows };
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
      const timestamp = Date.now();
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      cb(null, `${timestamp}_${sanitized}`);
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

/**
 * Resolve effective dates for all inflows by applying the Revenue tab date hierarchy:
 *   1. dateOverride from milestone_task_links (manual override)
 *   2. Linked operational/plan task dueDate
 *   3. Original planned/forecast date
 * 
 * Returns inflows with additional `effectiveDate` field representing the best-known
 * expected receipt date for cashflow calculations. `paymentReceivedDate` (actual receipt)
 * is never overridden - it represents confirmed bank receipt.
 */
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


const requireAuth = sharedRequireAuth;

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") {
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
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  if ((req.session as any)?.qmChallengePassed) return next();
  res.status(403).json({ error: "qm_challenge_required", message: "Quality Manager access code required", code: "QM_CHALLENGE_REQUIRED" });
}

function requireEpmChallenge(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") return next();
  if ((req.session as any)?.epmChallengePassed) return next();
  res.status(403).json({ error: "epm_challenge_required", message: "Engineering Program Manager access code required", code: "EPM_CHALLENGE_REQUIRED" });
}

function requireAdminOrEpm(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN" || role === "eng_program_manager" || role === "ENGINEERING_MANAGER") return next();
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

    // Notifications feature removed - notification inserts are now no-ops
    // for (const recipient of recipients) {
    //   if (recipient.id === changedByUserId) continue;
    //   await db.insert(notifications).values({...});
    // }
  } catch (err: any) {
    console.warn("[plan-notify] Failed to send plan change notifications:", err.message);
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
        storage.getProjectInfoByName(decodedName),
        (async () => {
          try {
            const pid = (await storage.getProjectInfoByName(decodedName))?.id;
            if (!pid) return { stages: [] };
            const stagesRes = await db.query.projectEngStages?.findMany({ where: (s: any, { eq: eq2 }: any) => eq2(s.projectId, pid) });
            return { stages: stagesRes || [] };
          } catch { return { stages: [] }; }
        })(),
        (async () => {
          try {
            const pid = (await storage.getProjectInfoByName(decodedName))?.id;
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
      const scheduleRag = computeScheduleRag(overduePlanTasks.length);

      // Cost RAG
      const totalExpenses = expenses.reduce((s: number, e: any) => s + (Number(e.expenseActualTotal) || 0), 0);
      const costRatio = budgetTotal > 0 ? totalExpenses / budgetTotal : 0;
      const costRag = computeCostRag(costRatio);

      // Quality RAG
      const qualityPhases = qualitySummaryRes.phases || [];
      const qualityGatesTotal = qualityPhases.length;
      const qualityGatesPassed = qualityPhases.filter((p: any) => p.applicableItems > 0 && p.approvedItems >= p.applicableItems).length;
      const qualityTotalItems = qualityPhases.reduce((s: number, p: any) => s + (p.applicableItems || 0), 0);
      const qualityApprovedItems = qualityPhases.reduce((s: number, p: any) => s + (p.approvedItems || 0), 0);
      const qualityProgressPct = qualityTotalItems > 0 ? (qualityApprovedItems / qualityTotalItems) * 100 : 0;
      const qualityRag = computeQualityRag(qualitySummaryRes.hasChecklist, qualityGatesPassed, qualityGatesTotal, qualityApprovedItems);

      // Revenue realised %
      const totalPaidInflows = inflows
        .filter((m: any) => m.inBank === 1 || m.inBank === true)
        .reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
      const revenueRealisedPct = contractValue > 0 ? (totalPaidInflows / contractValue) * 100 : 0;

      // COS realised %
      const isCosRealised = (e: any) => {
        const hasInvoice = !!(e.expenseInvoiceNumber && String(e.expenseInvoiceNumber).trim());
        const hasInvDate = !!(e.expenseInvoicedDate && String(e.expenseInvoicedDate).trim());
        return hasInvoice && hasInvDate;
      };
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

      // Alerts
      const overdueEngineeringCount = engBoardTasks.filter((t: any) => t.dueDate && t.dueDate < today && String(t.status).toUpperCase() !== "COMPLETE").length;

      res.json({
        schedule: { rag: scheduleRag, overdueTasks: overduePlanTasks.length, completionPct: Math.round(planCompletionPct * 10) / 10 },
        cost: { rag: costRag, ratio: Math.round(costRatio * 1000) / 1000, totalExpenses, budgetTotal },
        quality: { rag: qualityRag, gatesTotal: qualityGatesTotal, gatesPassed: qualityGatesPassed, totalItems: qualityTotalItems, approvedItems: qualityApprovedItems, progressPct: Math.round(qualityProgressPct * 10) / 10 },
        revenue: { contractValue, realisedPct: Math.round(revenueRealisedPct * 10) / 10, totalPaidInflows },
        cos: { realisedPct: Math.round(cosRealisedPct * 10) / 10, totalRealised: totalRealisedCos },
        engineering: { progressPct: Math.round(engProgressPct * 10) / 10, totalTasks: engTotalTasks, completedTasks: engCompletedTasks },
        overall: { rag: overallRag },
        alerts: {
          overduePlanTasks: overduePlanTasks.length,
          overdueEngineeringTasks: overdueEngineeringCount,
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
        db.select().from(normalizedCostLines),
        db.select().from(normalizedRevenueLines),
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

  app.get("/api/projects-summary", requireAuth, async (req, res) => {
    try {
      const useCanonicalPs = await isWorkItemsEnabled();
      const rolloutFlags = await getFeatureFlags([
        "promoted_core_project_detail_read",
      ]);
      const usePromotedProjectDetail = rolloutFlags.promoted_core_project_detail_read;

      const [allProjectInfo, allExpenses, rawInflows, rawPlans, allEditableFields, allTaskLinks, allOpTasks, uploadMetaRows, committedSmartImports, allNormCosts, allNormRevenue, allNormPlans, allPlanOverrides, lastImportRows, allClientsData, handoverRows] = await Promise.all([
        usePromotedProjectDetail ? listProjectInfoFromPromotedCoreCompat() : storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getAllProjectEditableFields(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        db.selectDistinct({ fileName: uploadMetadata.fileName }).from(uploadMetadata),
        db.selectDistinct({ projectName: smartImportRuns.projectName }).from(smartImportRuns).where(eq(smartImportRuns.status, 'COMMITTED')),
        db.select().from(normalizedCostLines),
        db.select().from(normalizedRevenueLines),
        useCanonicalPs
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
        Promise.resolve([]),
        db
          .select({
            projectName: smartImportRuns.projectName,
            lastImport: sql<string>`MAX(COALESCE(${smartImportRuns.committedAt}, ${smartImportRuns.uploadedAt}))`,
          })
          .from(smartImportRuns)
          .where(eq(smartImportRuns.status, 'COMMITTED'))
          .groupBy(smartImportRuns.projectName),
        usePromotedProjectDetail ? listClientsFromPromotedCoreCompat() : db.select().from(clients),
        db.execute(sql.raw(`SELECT project_id, status, rejection_reason FROM project_pd_pm_handover`)),
      ]);
      const allPlans = rawPlans;
      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

      const clientMap = new Map(allClientsData.map(c => [c.id, c.name]));

      const importedProjectNames = new Set<string>();
      for (const row of uploadMetaRows) {
        const fileName = row.fileName;
        if (!fileName) continue;
        const stripped = fileName.replace(/\.(xlsx|xlsm|xls)$/i, '');
        importedProjectNames.add(stripped);
        importedProjectNames.add(stripped.replace(/ /g, '_'));
      }
      for (const row of committedSmartImports) {
        if (row.projectName) {
          importedProjectNames.add(row.projectName);
          importedProjectNames.add(row.projectName.replace(/ /g, '_'));
          importedProjectNames.add(row.projectName + '_Tracker');
          importedProjectNames.add(row.projectName.replace(/ /g, '_') + '_Tracker');
        }
      }

      const lastImportByProject = new Map<string, string>();
      for (const row of lastImportRows) {
        const pName = row.projectName;
        const lastImport = row.lastImport;
        if (pName && lastImport) {
          const isoDate = new Date(lastImport).toISOString();
          lastImportByProject.set(pName, isoDate);
          lastImportByProject.set(pName.replace(/ /g, '_'), isoDate);
          lastImportByProject.set(pName + '_Tracker', isoDate);
          lastImportByProject.set(pName.replace(/ /g, '_') + '_Tracker', isoDate);
        }
      }

      const today = new Date().toISOString().split("T")[0];

      const expensesByProject = new Map<string, typeof allExpenses>();
      for (const expense of allExpenses) {
        if (!expensesByProject.has(expense.projectName)) expensesByProject.set(expense.projectName, []);
        expensesByProject.get(expense.projectName)!.push(expense);
      }

      const inflowsByProject = new Map<string, typeof allInflows>();
      for (const inflow of allInflows) {
        if (!inflowsByProject.has(inflow.projectName)) inflowsByProject.set(inflow.projectName, []);
        inflowsByProject.get(inflow.projectName)!.push(inflow);
      }

      const plansByProject = new Map<string, typeof allPlans>();
      for (const plan of allPlans) {
        if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
        plansByProject.get(plan.projectName)!.push(plan);
      }

      const editableMap = new Map(allEditableFields.map(f => [f.projectName, f]));
      const handoverMap = new Map<number, { status: string | null; rejection_reason: string | null }>();
      for (const row of ((handoverRows as any)?.rows || handoverRows || [])) {
        const handover = row as any;
        if (handover?.project_id != null) {
          handoverMap.set(Number(handover.project_id), {
            status: handover.status || null,
            rejection_reason: handover.rejection_reason || null,
          });
        }
      }

      const normCostsByProject = new Map<string, typeof allNormCosts>();
      for (const c of allNormCosts) {
        if (!normCostsByProject.has(c.projectName)) normCostsByProject.set(c.projectName, []);
        normCostsByProject.get(c.projectName)!.push(c);
      }
      const normRevByProject = new Map<string, typeof allNormRevenue>();
      for (const r of allNormRevenue) {
        if (!normRevByProject.has(r.projectName)) normRevByProject.set(r.projectName, []);
        normRevByProject.get(r.projectName)!.push(r);
      }
      const normPlansByProject = new Map<string, typeof allNormPlans>();
      for (const p of allNormPlans) {
        if (!normPlansByProject.has(p.projectName)) normPlansByProject.set(p.projectName, []);
        normPlansByProject.get(p.projectName)!.push(p);
      }

      const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

      const projectInfoNames = new Set(allProjectInfo.map(i => i.projectName));
      const projectInfoNormMap = new Map<string, string>();
      for (const piName of projectInfoNames) {
        const norm = piName.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim();
        projectInfoNormMap.set(norm, piName);
      }

      function normalizeForMatch(s: string): string {
        return s
          .replace(/_Tracker\d*$/i, "")
          .replace(/[_\-]/g, " ")
          .replace(/\bph(\d)/gi, "phase $1")
          .replace(/\bphase\s*(\d)/gi, "phase $1")
          .replace(/\bstd\b/gi, "standard")
          .replace(/\bgq\b/gi, "gq")
          .replace(/\s+/g, " ")
          .toLowerCase()
          .trim();
      }

      const projectInfoDeepNormMap = new Map<string, string>();
      for (const piName of projectInfoNames) {
        projectInfoDeepNormMap.set(normalizeForMatch(piName), piName);
      }

      function resolveToCanonical(name: string): string {
        if (projectInfoNames.has(name)) return name;
        const variants = [
          name.replace(/ /g, "_") + "_Tracker",
          name + "_Tracker",
          name.replace(/ /g, "_"),
        ];
        for (const v of variants) {
          if (projectInfoNames.has(v)) return v;
        }
        const normKey = name.replace(/[_ ]/g, " ").toLowerCase().trim();
        const fuzzyMatch = projectInfoNormMap.get(normKey);
        if (fuzzyMatch) return fuzzyMatch;
        for (const [piNorm, piName] of projectInfoNormMap) {
          if (piNorm.endsWith(normKey) || normKey.endsWith(piNorm)) return piName;
        }

        const deepNorm = normalizeForMatch(name);
        const deepMatch = projectInfoDeepNormMap.get(deepNorm);
        if (deepMatch) return deepMatch;

        for (const [piDeep, piName] of projectInfoDeepNormMap) {
          if (piDeep.includes(deepNorm) || deepNorm.includes(piDeep)) return piName;
        }

        const nameWords = deepNorm.split(" ").filter(w => w.length > 1);
        if (nameWords.length >= 1) {
          let bestMatch: string | null = null;
          let bestScore = 0;
          for (const [piDeep, piName] of projectInfoDeepNormMap) {
            const piWords = piDeep.split(" ").filter(w => w.length > 1);
            const matchingWords = nameWords.filter(w => piWords.some(pw => pw.includes(w) || w.includes(pw)));
            const score = matchingWords.length / Math.max(nameWords.length, piWords.length);
            if (score > bestScore && score >= 0.5) {
              bestScore = score;
              bestMatch = piName;
            }
          }
          if (bestMatch) return bestMatch;
        }

        return name;
      }

      const JUNK_NAMES = new Set(["PROJECT SIZE (kWp)", "FY 2026 Adhoc", "PROJECT MANAGERS"]);
      function isJunkName(name: string): boolean {
        return JUNK_NAMES.has(name) || /^(FY\s*\d|PROJECT\s+(SIZE|MANAGER))/i.test(name);
      }

      const allProjectNames = new Set<string>();
      for (const info of allProjectInfo) {
        if (!isJunkName(info.projectName)) allProjectNames.add(info.projectName);
      }
      for (const expense of allExpenses) {
        if (!isJunkName(expense.projectName)) allProjectNames.add(resolveToCanonical(expense.projectName));
      }
      for (const inflow of allInflows) {
        if (!isJunkName(inflow.projectName)) allProjectNames.add(resolveToCanonical(inflow.projectName));
      }
      for (const plan of allPlans) {
        if (!isJunkName(plan.projectName)) allProjectNames.add(resolveToCanonical(plan.projectName));
      }
      for (const c of allNormCosts) {
        if (!isJunkName(c.projectName)) allProjectNames.add(resolveToCanonical(c.projectName));
      }
      for (const r of allNormRevenue) {
        if (!isJunkName(r.projectName)) allProjectNames.add(resolveToCanonical(r.projectName));
      }
      for (const p of allNormPlans) {
        if (!isJunkName(p.projectName)) allProjectNames.add(resolveToCanonical(p.projectName));
      }

      const taskCountsByProject = new Map<string, Record<string, number>>();
      for (const task of allOpTasks) {
        const rawName = task.projectName;
        const trackerName = rawName.replace(/ /g, "_") + (rawName.endsWith("_Tracker") ? "" : "_Tracker");
        const key = allProjectNames.has(trackerName) ? trackerName : rawName;
        if (!taskCountsByProject.has(key)) taskCountsByProject.set(key, {});
        const counts = taskCountsByProject.get(key)!;
        const status = task.status || "TO DO";
        counts[status] = (counts[status] || 0) + 1;
      }

      const currentUser = (req as any).user;
      const currentUserId = currentUser?.id || currentUser?.userId;
      const currentUserName = currentUser?.name || "";
      const currentRole = currentUser?.role || "";
      const { FULL_OVERSIGHT_ROLES } = await import("./services/project-access-service");
      const isFullOversight = FULL_OVERSIGHT_ROLES.includes(currentRole);

      const userOwnedProjectIds = new Set<number>();
      const userAssignedProjectNames = new Set<string>();

      if (!isFullOversight && currentUserId) {
        for (const info of allProjectInfo) {
          if (info.pmUserId === currentUserId || info.pd === currentUserName) {
            userOwnedProjectIds.add(info.id);
            userAssignedProjectNames.add(info.projectName);
          }
        }
        for (const task of allOpTasks) {
          const assignees = (task.assignees || "").toLowerCase();
          const isAssigned = assignees.includes(currentUserName.toLowerCase()) ||
            (task as any).ownerUserId === currentUserId ||
            (task as any).createdBy === currentUserId;
          if (isAssigned && task.projectName) {
            userAssignedProjectNames.add(resolveToCanonical(task.projectName));
          }
        }
      }

      const scopeParam = (req.query.scope as string || "").toLowerCase();

      const projectsSummary = Array.from(allProjectNames).map(projectName => {
        const info = projectInfoMap.get(projectName);

        const cleanName = projectName.replace(/_Tracker\d*$/i, "").replace(/_/g, " ").trim();
        const underscoreName = cleanName.replace(/ /g, "_");
        const nameVariants = [projectName, cleanName, underscoreName, cleanName + "_Tracker", underscoreName + "_Tracker"];

        function lookupAll<T>(map: Map<string, T[]>): T[] {
          for (const v of nameVariants) {
            const data = map.get(v);
            if (data && data.length > 0) return data;
          }
          return [];
        }

        const projectExpenses = lookupAll(expensesByProject);
        const projectInflows = lookupAll(inflowsByProject);
        const projectPlans = lookupAll(plansByProject);
        const editable = editableMap.get(projectName) || editableMap.get(cleanName);
        const handover = info?.id ? handoverMap.get(info.id) : null;

        const normCosts = lookupAll(normCostsByProject);
        const normRev = lookupAll(normRevByProject);
        const normPlans = lookupAll(normPlansByProject);

        const useNormPlans = projectPlans.length === 0 && normPlans.length > 0;
        const planLikeRows = useNormPlans ? normPlans.map(np => ({
          taskNo: null as string | null,
          highLevelProgramme: np.taskName,
          actualStart: np.actualStartDate || np.startDate,
          actualEnd: np.actualEndDate || np.endDate,
          trueActualStart: np.actualStartDate || np.startDate,
          trueActualEnd: np.actualEndDate || np.endDate,
          durationDays: np.durationDays,
          actualPctComplete: np.pctComplete,
          expectedPctComplete: null as number | null,
        })) : projectPlans.filter((p: any) => !(p.rowNumber < 0 && p.isVirtual));

        const milestoneRowNumbers = new Set<number>();
        for (const p of (planLikeRows as any[])) {
          if (p.parentRowNumber != null && p.parentRowNumber !== 0 && p.parentRowNumber !== "") {
            milestoneRowNumbers.add(Number(p.parentRowNumber));
          }
        }
        for (const p of (planLikeRows as any[])) {
          if (p.isMilestone === true || (p.indentLevel === 0 && milestoneRowNumbers.has(p.rowNumber))) {
            milestoneRowNumbers.add(p.rowNumber);
          }
        }
        const leafPlanRows = (planLikeRows as any[]).filter((p: any) => !milestoneRowNumbers.has(p.rowNumber));

        // Compute milestone dates from plan tasks (Excel spec: max ActualEndDate matching descriptions)
        const pdFromPlan = findMaxEndDate(planLikeRows as any, ['bd handover', 'project charter handover']);
        const csFromPlan = findMinStartDate(planLikeRows as any, ['site establishment']);
        const commFromPlan = findMaxEndDate(planLikeRows as any, ['commissioning']);
        const omFromPlan = findMaxEndDate(planLikeRows as any, ['handover to matriarch']);
        const chFromPlan = findMaxEndDate(planLikeRows as any, ['handover to client']);

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

        // Duration = SA working days between Construction Start and Client Handover
        const duration = saWorkingDays(constructionStartDate, clientHandoverDate);

        // kW/Week = Size / working weeks (SA working days from Construction Start to Commissioning / 5)
        const sizeKwp = info?.sizeKwp ? parseFloat(info.sizeKwp) : null;
        const commWorkDays = saWorkingDays(constructionStartDate, commissioningDate);
        const workingWeeks = commWorkDays ? commWorkDays / 5 : null;
        const kwPerWeek = (sizeKwp && workingWeeks && workingWeeks > 0) ? sizeKwp / workingWeeks : null;

        let totalContractRevenue = 0;
        let actualRevenue = 0;
        if (projectInflows.length > 0) {
          for (const inflow of projectInflows) {
            if (inflow.milestoneAmount) {
              const amt = parseFloat(inflow.milestoneAmount) || 0;
              totalContractRevenue += amt;
              const manualInBank = (inflow as any).inBank === 1 || (inflow as any).inBank === '1' || (inflow as any).inBank === true;
              const hasInvoice = !!(inflow.milestoneInvoiceNumber && String(inflow.milestoneInvoiceNumber).trim());
              const hasPaymentReceived = !!(inflow.paymentReceivedDate && String(inflow.paymentReceivedDate).trim() && inflow.paymentReceivedDate !== '-');
              const isInBank = manualInBank || (hasPaymentReceived && hasInvoice);
              if (isInBank) {
                actualRevenue += amt;
              }
            }
          }
        } else if (normRev.length > 0) {
          for (const rev of normRev) {
            if (rev.amountExVat) {
              const amt = parseFloat(rev.amountExVat) || 0;
              totalContractRevenue += amt;
              const manualInBank = (rev as any).inBank === 1 || (rev as any).inBank === '1' || (rev as any).inBank === true;
              const hasInvoice = !!(rev.invoiceNumber && String(rev.invoiceNumber).trim());
              const hasPaymentReceived = !!(rev.paidDate && String(rev.paidDate).trim() && rev.paidDate !== '-');
              const isInBank = manualInBank || (hasPaymentReceived && hasInvoice);
              if (isInBank) {
                actualRevenue += amt;
              }
            }
          }
        }

        let totalExpenses = 0;
        let actualExpenses = 0;
        if (projectExpenses.length > 0) {
          for (const expense of projectExpenses) {
            if (expense.expenseActualTotal) {
              const amt = parseFloat(expense.expenseActualTotal) || 0;
              totalExpenses += amt;
              const state = (expense as any).computedState || classifyExpenseState(expense as any);
              if (state === 'Paid') {
                actualExpenses += amt;
              }
            }
          }
        } else if (normCosts.length > 0) {
          for (const cost of normCosts) {
            if (cost.amountExVat) {
              const amt = parseFloat(cost.amountExVat) || 0;
              totalExpenses += amt;
              const state = classifyExpenseState(mapCostToExpenseInput(cost));
              if (state === 'Paid') {
                actualExpenses += amt;
              }
            }
          }
        }

        const gpPercent = totalContractRevenue > 0 ? 1 - (totalExpenses / totalContractRevenue) : null;

        // Project % Complete and Expected % — prefer summary row (No./#) from Excel
        const summaryRow = (planLikeRows as any[]).find((p: any) => {
          const tn = (p.taskNo || '').toString().toLowerCase().trim();
          return tn === 'no.' || tn === 'no' || tn === '#';
        });
        let projectPctComplete: number | null = null;
        let expectedPctComplete: number | null = null;
        if (summaryRow) {
          projectPctComplete = summaryRow.actualPctComplete ?? null;
          expectedPctComplete = summaryRow.expectedPctComplete ?? null;
        }
        if (projectPctComplete === null) {
          let totalWeight = 0, weightedSum = 0;
          for (const p of leafPlanRows) {
            const dur = p.durationDays && p.durationDays > 0 ? p.durationDays : 1;
            weightedSum += (p.actualPctComplete ?? 0) * dur;
            totalWeight += dur;
          }
          projectPctComplete = totalWeight > 0 ? weightedSum / totalWeight : null;
        }
        if (expectedPctComplete === null) {
          const todayDate = today;
          let totalExpWeight = 0, weightedExpSum = 0;
          for (const task of leafPlanRows) {
            const dur = task.durationDays && task.durationDays > 0 ? task.durationDays : 1;
            totalExpWeight += dur;
            if (task.expectedPctComplete !== null && task.expectedPctComplete !== undefined) {
              weightedExpSum += task.expectedPctComplete * dur;
              continue;
            }
            const tStart = (task.trueActualStart || task.actualStart || "").substring(0, 10);
            const tEnd = (task.trueActualEnd || task.actualEnd || "").substring(0, 10);
            if (!tStart || !tEnd || !/^\d{4}-\d{2}-\d{2}/.test(tStart) || !/^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
              continue;
            }
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
            weightedExpSum += exp * dur;
          }
          expectedPctComplete = totalExpWeight > 0 ? weightedExpSum / totalExpWeight : null;
        }
        const deltaVsExpected = (projectPctComplete !== null && expectedPctComplete !== null)
          ? projectPctComplete - expectedPctComplete : null;

        let revenueOutstanding = 0;
        if (projectInflows.length > 0) {
          for (const inflow of projectInflows) {
            if (inflow.milestoneAmount) {
              const hasInvoice = !!(inflow.milestoneInvoiceNumber && inflow.milestoneInvoiceNumber.trim());
              const hasPaidDate = inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inflow.paymentReceivedDate);
              const paidDateConf = inflow.paidDateConfirmed ?? inflow.paymentReceivedDateConfirmed ?? null;
              const paidDateClr = inflow.paidDateFontColor ?? inflow.paymentReceivedDateFontColor ?? null;
              const hasPaymentColorInfo = paidDateConf != null || (paidDateClr != null && paidDateClr !== '');
              const paidBlack = hasPaidDate && (paidDateConf === true || paidDateClr === 'black' || !hasPaymentColorInfo);
              const isInBank = hasInvoice && paidBlack;
              if (hasInvoice && !isInBank) {
                revenueOutstanding += parseFloat(inflow.milestoneAmount) || 0;
              }
            }
          }
        } else if (normRev.length > 0) {
          for (const rev of normRev) {
            if (rev.amountExVat) {
              const hasInvoice = !!(rev.invoiceNumber && rev.invoiceNumber.trim());
              const hasPaidDate = rev.paidDate && /^\d{4}-\d{2}-\d{2}/.test(rev.paidDate);
              const hasPaymentColorInfo = rev.paidDateConfirmed != null || (rev.paidDateFontColor != null && rev.paidDateFontColor !== '');
              const paidBlack = hasPaidDate && (rev.paidDateConfirmed === true || rev.paidDateFontColor === 'black' || !hasPaymentColorInfo);
              const isInBank = hasInvoice && paidBlack;
              if (hasInvoice && !isInBank) {
                revenueOutstanding += parseFloat(rev.amountExVat) || 0;
              }
            }
          }
        }

        // Expenses Due (Excel spec): SUM(ExpenseActualTotal) where ExpensePaymentDate < today AND ExpenseInvoiceNumber is blank
        let expensesDue = 0;
        if (projectExpenses.length > 0) {
          for (const expense of projectExpenses) {
            if (expense.expenseActualTotal) {
              const hasPastPaymentDate = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(expense.expensePaymentDate) && expense.expensePaymentDate < today;
              const noInvoice = !expense.expenseInvoiceNumber || expense.expenseInvoiceNumber.trim() === '';
              if (hasPastPaymentDate && noInvoice) {
                expensesDue += parseFloat(expense.expenseActualTotal) || 0;
              }
            }
          }
        } else if (normCosts.length > 0) {
          for (const cost of normCosts) {
            if (cost.amountExVat) {
              const hasPastPaymentDate = cost.paidDate && /^\d{4}-\d{2}-\d{2}/.test(cost.paidDate) && cost.paidDate < today;
              const noInvoice = !cost.invoiceNumber || cost.invoiceNumber.trim() === '';
              if (hasPastPaymentDate && noInvoice) {
                expensesDue += parseFloat(cost.amountExVat) || 0;
              }
            }
          }
        }

        return {
          project_info_id: info?.id || null,
          project_name: projectName,
          client_id: info?.clientId || null,
          client_name: info?.clientId ? (clientMap.get(info.clientId) || null) : null,
          size_kwp: sizeKwp,
          pd: info?.pd || null,
          pm: info?.pm || null,
          cost_proposal_signed: editable?.costProposalSigned || null,
          cost_proposal_type: editable?.costProposalType || null,
          cost_proposal_link: editable?.costProposalLink || null,
          cost_proposal_na_reason: editable?.costProposalNaReason || null,
          funding_signed: editable?.fundingSigned || null,
          funding_type: editable?.fundingType || null,
          funding_link: editable?.fundingLink || null,
          funding_na_reason: editable?.fundingNaReason || null,
          epc_contract_signed: editable?.epcContractSigned || null,
          epc_contract_type: editable?.epcContractType || null,
          epc_contract_link: editable?.epcContractLink || null,
          epc_contract_na_reason: editable?.epcContractNaReason || null,
          financial_close_achieved: !!(
            (editable?.costProposalType === 'link' || editable?.costProposalType === 'na') &&
            (editable?.fundingType === 'link' || editable?.fundingType === 'na') &&
            (editable?.epcContractType === 'link' || editable?.epcContractType === 'na')
          ),
          phase: info?.executionPhase || info?.phase || null,
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
          contract_value: info?.contractValue ? parseFloat(String(info.contractValue)) || null : null,
          total_contract_revenue: totalContractRevenue || (info?.contractValue ? parseFloat(String(info.contractValue)) || 0 : 0),
          actual_revenue: actualRevenue,
          total_expenses: totalExpenses,
          actual_expenses: actualExpenses,
          gp_percent: gpPercent,
          revenue_outstanding: revenueOutstanding,
          expenses_due: expensesDue,
          current_vo_total: editable?.currentVoTotal ? parseFloat(editable.currentVoTotal) : 0,
          comments: editable?.comments || null,
          latest_update: editable?.latestUpdate || null,
          latest_update_at: editable?.latestUpdateAt || null,
          latest_update_by: editable?.latestUpdateBy || null,
          escalation_level: info?.escalationLevel || null,
          rag_status: info?.ragStatus || (deltaVsExpected !== null
            ? (deltaVsExpected >= -0.05 ? "Green" : deltaVsExpected >= -0.15 ? "Amber" : "Red")
            : null),
          task_status_counts: taskCountsByProject.get(projectName) || taskCountsByProject.get(cleanName) || {},
          phase_updated_at: info?.phaseUpdatedAt || null,
          has_tracker_import: nameVariants.some(v => importedProjectNames.has(v)) || importedProjectNames.has(cleanName),
          last_import_at: nameVariants.reduce<string | null>((acc, v) => acc || lastImportByProject.get(v) || null, null) || lastImportByProject.get(cleanName) || null,
          is_active: info?.isActive !== false && info?.phase?.toLowerCase() !== "gone",
          pd_pm_handover_status: handover?.status || "DRAFT",
          pd_pm_handover_rejection_reason: handover?.rejection_reason || null,
          next_open_inflow_milestone: (() => {
            const open = projectInflows
              .filter((inf: any) => (!inf.paymentReceivedDate || inf.paymentReceivedDate.trim() === '') && inf.milestoneName)
              .sort((a: any, b: any) => (a.rowNumber || 0) - (b.rowNumber || 0));
            if (open.length === 0) return null;
            const next = open[0];
            const plannedDate = next.effectiveDate || next.computedForecastReceiptDate || next.plannedPaymentDate || null;
            const isOverdue = plannedDate && /^\d{4}-\d{2}-\d{2}/.test(plannedDate) && plannedDate < today;
            return { name: next.milestoneName, plannedDate, overdue: !!isOverdue, openCount: open.length };
          })(),
          _user_is_pm: info?.pmUserId === currentUserId,
          _user_is_pd: info?.pd === currentUserName,
          _user_has_tasks: !isFullOversight ? userAssignedProjectNames.has(projectName) || nameVariants.some(v => userAssignedProjectNames.has(v)) : false,
          _user_scope: isFullOversight ? "full_oversight" : (
            (info?.pmUserId === currentUserId || info?.pd === currentUserName) ? "owned" :
            (userAssignedProjectNames.has(projectName) || nameVariants.some(v => userAssignedProjectNames.has(v))) ? "assigned" : "visible"
          ),
        };
      });

      let finalResult = projectsSummary;
      // RLS enforcement: scoped users only see owned/assigned projects
      if (!isFullOversight) {
        finalResult = projectsSummary.filter((p: any) => p._user_scope === "owned" || p._user_scope === "assigned");
      } else if (scopeParam === "owned") {
        // Full oversight users can optionally narrow to their own projects
        finalResult = projectsSummary.filter((p: any) => p._user_scope === "owned" || p._user_scope === "assigned");
      }

      const sharedSummaryByProject = await getPlatformProjectSummaryMap({
        projectIds: finalResult
          .map((project: any) => Number(project.project_info_id))
          .filter((value: number) => Number.isFinite(value)),
      });
      finalResult = finalResult.map((project: any) => ({
        ...project,
        shared_summary: project.project_info_id
          ? sharedSummaryByProject.get(Number(project.project_info_id)) || null
          : null,
      }));

      if (usePromotedProjectDetail || req.query.compare === "1" || req.query.compare === "true") {
        const projectDetailComparison = await compareProjectDetailMasterReadiness();
        if (projectDetailComparison.status !== "ready") {
          console.warn("[promoted-read][project-detail] mismatch detected", projectDetailComparison);
        }
        res.setHeader("X-Promoted-Project-Detail-Read", usePromotedProjectDetail ? "enabled" : "disabled");
        res.setHeader("X-Promoted-Project-Detail-Comparison-Status", projectDetailComparison.status);
      }

      res.json(finalResult);
    } catch (error) {
      console.error("Projects summary fetch error:", error);
      res.status(500).json({ error: "Failed to fetch projects summary", message: "Failed to fetch projects summary" });
    }
  });

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
        .where(sql`${projectExecutionState.isActive} IS NOT FALSE`);
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
        db.select().from(normalizedCostLines),
        db.select().from(normalizedRevenueLines),
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
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
        cb(null, `${ts}_${sanitized}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
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

  // ==================== CASHFLOW 2026 API ====================

  app.get("/api/cashflow-2026", requireAuth, async (req, res) => {
    try {
      const projectFilter = req.query.project ? String(req.query.project) : null;

      const [legacyExp, legacyInf, manualBalances, opexBudgets, opexWeeklyOverrides, availPaymentOverrides, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllCashflowWeeklyManual(),
        storage.getAllOpexBudgetMonthly(),
        storage.getAllOpexWeeklyManual(),
        storage.getAllAvailablePaymentOverrides(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedData = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const allExpenses = mergedData.expenses;
      const allInflows = resolveInflowEffectiveDates(mergedData.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const manualMap = new Map(manualBalances.map(m => [m.weekStartDate, parseFloat(m.openingBalance || "0")]));
      const opexMonthlyMap = new Map(opexBudgets.map(o => [o.monthKey, parseFloat(o.amount || "0")]));
      const opexWeeklyMap = new Map(opexWeeklyOverrides.map(o => [o.weekStartDate, parseFloat(o.opexAmount || "0")]));
      const availPayMap = new Map(availPaymentOverrides.map(o => [o.weekStartDate, { value: parseFloat(o.overrideValue || "0"), reason: o.reason }]));

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
          if (projectFilter && inflow.projectName !== projectFilter) continue;
          const d = inflow.effectiveDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (d >= weekStart && d < weekEnd && inflow.milestoneAmount) {
            projectInflowsSum += parseFloat(inflow.milestoneAmount) || 0;
          }
        }

        let projectOutflowsSum = 0;
        for (const expense of allExpenses) {
          if (projectFilter && expense.projectName !== projectFilter) continue;
          const d = expense.expensePaymentDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (d >= weekStart && d < weekEnd && expense.expenseActualTotal) {
            projectOutflowsSum += parseFloat(expense.expenseActualTotal) || 0;
          }
        }

        const computedOpening = runningBalance;
        const hasManualOverride = !projectFilter && manualMap.has(weekStart);
        const openingBalance = hasManualOverride ? manualMap.get(weekStart)! : computedOpening;
        const balanceDelta = hasManualOverride ? openingBalance - computedOpening : 0;

        const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
        const monthlyOpex = opexMonthlyMap.get(mk) || 0;
        const weeksCount = weeksInMonth.get(mk) || 1;
        const computedOpex = monthlyOpex / weeksCount;
        const hasOpexOverride = opexWeeklyMap.has(weekStart);
        const opexOutflows = projectFilter ? 0 : (hasOpexOverride ? opexWeeklyMap.get(weekStart)! : computedOpex);

        const totalOutflows = opexOutflows + projectOutflowsSum;
        const closingBalance = openingBalance + projectInflowsSum - totalOutflows;
        const computedAvailablePayment = openingBalance + projectInflowsSum - totalOutflows;
        const hasAvailPayOverride = availPayMap.has(weekStart);
        const availPayOverride = availPayMap.get(weekStart);
        const availablePayment = hasAvailPayOverride ? availPayOverride!.value : computedAvailablePayment;
        const availPayReason = hasAvailPayOverride ? availPayOverride!.reason : null;

        weeks.push({
          weekStart,
          weekEnd,
          projectInflows: projectInflowsSum,
          projectOutflows: projectOutflowsSum,
          openingBalance,
          computedOpening,
          hasManualOverride,
          balanceDelta,
          opexOutflows,
          computedOpex,
          hasOpexOverride,
          closingBalance,
          availablePayment,
          computedAvailablePayment,
          hasAvailPayOverride,
          availPayReason,
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

  app.get("/api/cashflow-2026/detail", requireAuth, async (req, res) => {
    try {
      const weekStart = String(req.query.week || "");
      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return res.status(400).json({ error: "Invalid week parameter", message: "Provide ?week=YYYY-MM-DD" });
      }
      const projectFilter = req.query.project ? String(req.query.project) : null;

      const [y, m, d] = weekStart.split('-').map(Number);
      const wsDate = new Date(Date.UTC(y, m - 1, d));
      wsDate.setUTCDate(wsDate.getUTCDate() + 7);
      const weekEnd = wsDate.toISOString().split('T')[0];

      const [legacyExp, legacyInf, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedDetail = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const resolvedInflows = resolveInflowEffectiveDates(mergedDetail.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const outflows = mergedDetail.expenses
        .filter((e: any) => {
          if (projectFilter && e.projectName !== projectFilter) return false;
          const pd = e.expensePaymentDate;
          if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return false;
          return pd >= weekStart && pd < weekEnd;
        })
        .map((e: any) => ({
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          expenseInvoiceNumber: e.expenseInvoiceNumber,
          expensePaymentDate: e.expensePaymentDate,
          expenseActualTotal: e.expenseActualTotal ? parseFloat(e.expenseActualTotal) : 0,
        }));

      const inflows = resolvedInflows
        .filter((inf: any) => {
          if (projectFilter && inf.projectName !== projectFilter) return false;
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

  app.post("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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

      logAuditFromReq(req, { entityType: "cashflow_balance", action: "update", entityId: weekStartDate, changesJson: { description: "Opening balance updated", weekStartDate, openingBalance, clearForward } });
      res.json({ ...result, clearedWeeks });
    } catch (error) {
      console.error("Opening balance save error:", error);
      res.status(500).json({ error: "Failed to save opening balance", message: "Failed to save opening balance" });
    }
  });

  app.get("/api/cashflow-2026/balance-history", requireAuth, async (req, res) => {
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

  app.delete("/api/cashflow-2026/opening-balance", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
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
      logAuditFromReq(req, { entityType: "cashflow_balance", action: "delete", entityId: weekStartDate, changesJson: { description: "Opening balance deleted", weekStartDate } });
      res.json({ ok: true });
    } catch (error) {
      console.error("Opening balance delete error:", error);
      res.status(500).json({ error: "Failed to delete opening balance" });
    }
  });

  app.post("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
    try {
      const { monthKey, amount } = req.body;
      if (!monthKey || amount == null) {
        return res.status(400).json({ error: "monthKey and amount required" });
      }
      const result = await storage.upsertOpexBudgetMonthly(monthKey, String(amount));
      logAuditFromReq(req, { entityType: "opex_budget", action: "update", entityId: monthKey, changesJson: { description: "OPEX budget updated", monthKey, amount } });
      res.json(result);
    } catch (error) {
      console.error("OPEX budget save error:", error);
      res.status(500).json({ error: "Failed to save OPEX budget", message: "Failed to save OPEX budget" });
    }
  });

  app.get("/api/cashflow-2026/opex-budget", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
    try {
      const entries = await storage.getAllOpexBudgetMonthly();
      res.json(entries);
    } catch (error) {
      console.error("OPEX budget fetch error:", error);
      res.status(500).json({ error: "Failed to fetch OPEX budgets", message: "Failed to fetch OPEX budgets" });
    }
  });

  app.post("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
    try {
      const { weekStartDate, opexAmount } = req.body;
      if (!weekStartDate || opexAmount == null) {
        return res.status(400).json({ error: "weekStartDate and opexAmount required" });
      }
      const result = await storage.upsertOpexWeeklyManual(weekStartDate, String(opexAmount));
      logAuditFromReq(req, { entityType: "opex_weekly", action: "update", entityId: weekStartDate, changesJson: { description: "OPEX weekly override updated", weekStartDate, opexAmount } });
      res.json(result);
    } catch (error) {
      console.error("OPEX weekly save error:", error);
      res.status(500).json({ error: "Failed to save weekly OPEX" });
    }
  });

  app.delete("/api/cashflow-2026/opex-weekly", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
    try {
      const { weekStartDate } = req.body;
      if (!weekStartDate) {
        return res.status(400).json({ error: "weekStartDate required" });
      }
      await storage.deleteOpexWeeklyManual(weekStartDate);
      logAuditFromReq(req, { entityType: "opex_weekly", action: "delete", entityId: weekStartDate, changesJson: { description: "OPEX weekly override deleted", weekStartDate } });
      res.json({ success: true });
    } catch (error) {
      console.error("OPEX weekly delete error:", error);
      res.status(500).json({ error: "Failed to delete weekly OPEX override" });
    }
  });

  app.post("/api/cashflow-2026/available-payment", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
    try {
      const { weekStartDate, overrideValue, reason, computedValue } = req.body;
      if (!weekStartDate || overrideValue == null) {
        return res.status(400).json({ error: "weekStartDate and overrideValue required" });
      }

      const existingOverrides = await storage.getAllAvailablePaymentOverrides();
      const existing = existingOverrides.find(o => o.weekStartDate === weekStartDate);
      const previousValue = existing ? existing.overrideValue : null;
      const newVal = parseFloat(String(overrideValue));
      const compVal = computedValue != null ? parseFloat(String(computedValue)) : null;

      const user = req.user as any;
      await storage.addAvailablePaymentHistory({
        weekStartDate,
        previousValue: previousValue || null,
        newValue: String(newVal),
        computedValue: compVal != null ? String(compVal) : null,
        reason: reason || null,
        changedBy: user?.username || user?.name || null,
      });

      const result = await storage.upsertAvailablePaymentOverride(
        weekStartDate,
        String(newVal),
        reason || null,
        user?.username || user?.name || null
      );

      logAuditFromReq(req, { entityType: "available_payment", action: "update", entityId: weekStartDate, changesJson: { description: "Available payment override updated", weekStartDate, overrideValue, reason } });
      res.json(result);
    } catch (error) {
      console.error("Available payment save error:", error);
      res.status(500).json({ error: "Failed to save available payment override" });
    }
  });

  app.delete("/api/cashflow-2026/available-payment", requireAuth, requirePermission("cashflow", "edit"), async (req, res) => {
    try {
      const { weekStartDate } = req.body;
      if (!weekStartDate) {
        return res.status(400).json({ error: "weekStartDate required" });
      }
      const existingOverrides = await storage.getAllAvailablePaymentOverrides();
      const existing = existingOverrides.find(o => o.weekStartDate === weekStartDate);
      if (existing) {
        const user = req.user as any;
        await storage.addAvailablePaymentHistory({
          weekStartDate,
          previousValue: existing.overrideValue || null,
          newValue: "0",
          computedValue: null,
          reason: "Override cleared",
          changedBy: user?.username || user?.name || null,
        });
        await storage.deleteAvailablePaymentOverride(weekStartDate);
      }
      logAuditFromReq(req, { entityType: "available_payment", action: "delete", entityId: weekStartDate, changesJson: { description: "Available payment override deleted", weekStartDate } });
      res.json({ ok: true });
    } catch (error) {
      console.error("Available payment delete error:", error);
      res.status(500).json({ error: "Failed to delete available payment override" });
    }
  });

  app.get("/api/cashflow-2026/available-payment-history", requireAuth, requirePermission("cashflow", "view"), async (req, res) => {
    try {
      const weekStart = req.query.week ? String(req.query.week) : null;
      if (!weekStart) {
        return res.status(400).json({ error: "week query parameter required" });
      }
      const history = await storage.getAvailablePaymentHistory(weekStart);
      res.json(history);
    } catch (error) {
      console.error("Available payment history error:", error);
      res.status(500).json({ error: "Failed to fetch available payment history" });
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

  app.get("/api/rev-tracker", requireAuth, requireAdmin, async (req, res) => {
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

      const months: any[] = [];
      const startMonth = new Date(Date.UTC(2025, 8, 1));

      let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0, ytdRevRealised = 0;

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
        const isConfirmedPay = isCashflowConfirmedCheck(exp) && !_isFuture;

        let cosState = 'Planned';
        if (isConfirmedPay) {
          cosState = 'Paid';
        } else if (isRealised) {
          cosState = 'Realised';
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
          invoiceDateConfirmed: isDateConfirmedCheck(exp.invoiceDateConfirmed, exp.invoiceDateFontColor),
          paymentDate: payDate,
          paymentDateConfirmed: isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor),
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

      // Static COS budget for variance
      const staticCosBudget: Record<string, number> = {
        '2025-09': 8083466.99, '2025-10': 16346971.77, '2025-11': 20803804.86,
        '2025-12': 12381055.48, '2026-01': 12395435.22, '2026-02': 20724666.08,
        '2026-03': 30199956.69, '2026-04': 21137178.14, '2026-05': 31405517.81,
        '2026-06': 41720854.07, '2026-07': 30116780.50, '2026-08': 73983803.91,
      };

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
        if (mk <= currentMK) ytdBudget += staticCosBudget[mk] ?? 0;
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
      }).from(normalizedRevenueLines);

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
      }).from(normalizedCostLines);

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
      }).from(normalizedRevenueLines);

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
      }).from(normalizedCostLines);

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
        db.select().from(normalizedRevenueLines),
        db.select().from(normalizedCostLines),
        db.select().from(smartImportRuns).where(eq(smartImportRuns.status, 'COMMITTED')),
        // Read ENG work_items
        db.select().from(workItems).where(and(eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt))),
        db.execute(sql`SELECT id, project_id, status, title, due_date, assigned_approver FROM approvals`),
        getAllPMWorkItemsAsProjectPlan(),
        db.execute(sql`SELECT id, project_name, severity, status, title, owner_user_id, due_date FROM qc_warning`),
        db.execute(sql`SELECT id, name FROM users`),
        db.select().from(cashflowPoints),
        db.select().from(financeRevenueMonthly),
        db.select().from(financeCosMonthly),
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
          _taskWeight: 0, _taskActual: 0, _taskExpected: 0,
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

      for (const t of planRows) {
        const proj = t.projectId ? projectById.get(Number(t.projectId)) : projectByName.get(String(t.projectName || '').toLowerCase());
        if (!proj) continue;
        const row = ensureRow(proj);
        const wiStart = (t.actualStart || t.startDate || '').slice(0,10);
        const wiEnd = (t.actualEnd || t.endDate || '').slice(0,10);
        if (wiStart && wiEnd && wiStart <= fyEnd && wiEnd >= fyStart) row.__hasFyItem = true;
        const w = Math.max(1, toNum(t.durationDays));
        const actual = toNum(t.actualPctComplete) * 100;
        let expected = t.expectedPctComplete == null ? null : toNum(t.expectedPctComplete) * 100;
        if (expected == null) {
          const s = wiStart;
          const e = wiEnd;
          if (s && e && s < e) {
            expected = today <= s ? 0 : today >= e ? 100 : Math.max(0, Math.min(100, ((new Date(today).getTime()-new Date(s).getTime())/(new Date(e).getTime()-new Date(s).getTime()))*100));
          } else expected = 0;
        }
        row._taskWeight += w; row._taskActual += actual * w; row._taskExpected += expected * w;
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
          const isRealised = cosOverrideStatus ? cosOverrideStatus === 'COS Realised' : c.cosRealised === true;
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
        row.expectedProgressPct = row._taskWeight > 0 ? row._taskExpected / row._taskWeight : 0;
        row.scheduleVariancePct = row.actualProgressPct - row.expectedProgressPct;
        // Compute RAG from progress delta when manual ragStatus is absent (matching projects-summary)
        if (row.rag === 'UNKNOWN') {
          const delta = row.scheduleVariancePct;
          row.rag = delta >= -5 ? 'Green' : delta >= -15 ? 'Amber' : 'Red';
        }
        row.openInflowFy = row.plannedRevenueFy - row.receivedInflowFy;
        row.openExpenditureFy = row.plannedExpenditureFy - row.paidExpenditureFy;
        row.grossMarginPctFy = row.plannedRevenueFy > 0 ? Number((((row.plannedRevenueFy - row.plannedExpenditureFy) / row.plannedRevenueFy) * 100).toFixed(1)) : null;
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
          grossMarginPctFy: sum('plannedRevenueFy') > 0 ? Number((((sum('plannedRevenueFy') - sum('plannedExpenditureFy')) / sum('plannedRevenueFy')) * 100).toFixed(1)) : null,
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
        projects: projects.map(({ _taskWeight, _taskActual, _taskExpected, _engOpen, _qualityOpen, _approvalsPending, _inflowRisk, _outflowRisk, __hasFyItem, ...rest }: any) => rest),
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
          const hasInvoiceNum = inflow.milestoneInvoiceNumber && inflow.milestoneInvoiceNumber.trim() !== '';
          const paymentNotReceived = !inflow.paymentReceivedDate || inflow.paymentReceivedDate.trim() === '';
          const rawInBank = (inflow as any).inBank === 1 || (inflow as any).inBank === '1' || (inflow as any).inBank === true;
          const overrideInBank = inBankOverrideSet.has(`${inflow.projectName}::${inflow.rowNumber}`);
          const markedInBank = rawInBank || overrideInBank;
          const dateToCheck = inflow.effectiveDate || inflow.invoiceRaisedDate;
          const dateInPast = dateToCheck && /^\d{4}-\d{2}-\d{2}/.test(dateToCheck) && dateToCheck < today;
          if (amt > 0 && hasInvoiceNum && paymentNotReceived && !markedInBank && dateInPast) {
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

  // ==================== PROJECTS ROUTES ====================

  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
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
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project", message: "Failed to fetch project" });
    }
  });

  // ==================== TASKS ROUTES ====================

  app.get("/api/tasks", requireAuth, async (req, res) => {
    try {
      const { projectId } = req.query;
      if (projectId && typeof projectId === 'string') {
        const tasks = await storage.getTasksByProject(parseInt(projectId));
        return res.json(tasks);
      }
      const tasks = await storage.getAllTasks();

      const user = (req as any).user;
      const role = user?.role || "";
      const FULL_ACCESS_ROLES = ["admin", "COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "ENGINEERING_MANAGER", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER"];
      if (FULL_ACCESS_ROLES.includes(role)) {
        return res.json(tasks);
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
      res.json(scopedTasks);
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
      const overridesWithUser = overrides.map((o: any) => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyRevenueTrackingOverrides(overridesWithUser);

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

      logAuditFromReq(req, { entityType: "revenue_tracking_override", action: "create", changesJson: { description: `${overrides.length} revenue tracking override(s) saved`, count: overrides.length, projectNames: [...new Set(overrides.map((o: any) => o.projectName))] } });
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
      await storage.deleteRevenueTrackingOverridesByProject(projectName);

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
        const inBank = manualInBank || (hasPaymentReceived && hasInvoice);

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
          flags.push('Invoice raised, payment outstanding');
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
      const invoiced = milestones.filter((m: any) => m.status === 'invoiced').reduce((s: number, m: any) => s + (parseFloat(m.milestoneAmount) || 0), 0);
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

  app.post("/api/expenditure/overrides", requireAuth, requireAdmin, requirePermission('financials', 'edit'), async (req, res) => {
    try {
      const { overrides, overrideCategory, overrideComment } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const effectiveCategory = overrideCategory && OVERRIDE_CATEGORIES.includes(overrideCategory) ? overrideCategory : 'DATA_CORRECTION';
      const effectiveComment = (overrideComment && typeof overrideComment === "string" && overrideComment.trim().length >= 3) ? overrideComment : "Inline edit";
      const userId = req.user?.id;
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
      };

      const projectNames = [...new Set(overrides.map((o: any) => o.projectName))];
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
            oldRecord: {},
            newRecord: { [o.fieldName]: o.overrideValue },
          });
        }
      } catch (auditErr: any) {
        console.warn("[audit] Expenditure override audit failed:", auditErr.message);
      }

      // Record manual edit flags for conflict detection during import
      for (const [expenseId, fields] of rowGroups.entries()) {
        for (const fieldName of Object.keys(fields)) {
          recordManualEditFlag({
            entityType: "program_expense",
            entityId: expenseId,
            fieldName,
            editedByUserId: userId,
            editedByName: (req as any).user?.name,
          });
        }
      }

      logAuditFromReq(req, { entityType: "expenditure_override", action: "create", changesJson: { description: `${overrides.length} expenditure override(s) saved`, count: overrides.length, projectNames: [...new Set(overrides.map((o: any) => o.projectName))] } });
      res.json({ message: "Expenditure overrides saved and applied", count: saved.length, overrides: saved });
    } catch (error) {
      console.error("Failed to save expenditure overrides:", error);
      res.status(500).json({ error: "Failed to save expenditure overrides", message: error instanceof Error ? error.message : "Failed to save expenditure overrides" });
    }
  });

  app.delete("/api/expenditure/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      await storage.deleteExpenditureOverridesByProject(projectName);

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

      await storage.upsertManyExpenditureOverrides([
        { projectName, rowNumber, fieldName: field, overrideValue: color },
        ...(confirmedField ? [{ projectName, rowNumber, fieldName: confirmedField, overrideValue: isBlack ? 'true' : 'false' }] : []),
      ]);

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

        const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
        const paymentDateBlack = hasPayDate && isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);

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

  app.post("/api/admin/mark-active", requireAuth, async (req, res) => {
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
      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/projects-summary`);
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

  // ==================== PROJECT PLAN SCHEDULING API ====================

  // Get working plan with CPM calculation for a project
  app.get("/api/projects/:projectName/working-plan", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);

      // Get or create active scenario
      const scenario = await storage.getOrCreateActiveScenario(decodedName);

      // Get base tasks from work_items (PM/SMART_IMPORT)
      const baseTasks = await storage.getProjectPlansByProject(decodedName);

      // Get task overrides
      const taskOverrides = await storage.getTaskOverridesByScenario(scenario.id);

      // Apply overrides to get working tasks
      const workingTasks = applyOverridesToTasks(
        baseTasks.map(t => ({
          id: t.id,
          taskNo: t.taskNo,
          name: t.highLevelProgramme,
          startDate: t.actualStart,
          endDate: t.actualEnd,
          type: null,
          percentComplete: t.actualPctComplete ?? null,
          isBaseline: true,
        })),
        taskOverrides
      );

      // Get base dependencies
      const baseDeps = await storage.getDependenciesByProject(decodedName);

      // Get dependency overrides
      const depOverrides = await storage.getDependencyOverridesByScenario(scenario.id);

      // Apply dependency overrides
      const workingDeps = applyOverridesToDependencies(
        baseDeps.map(d => ({
          id: d.id,
          predecessorTaskId: d.predecessorTaskId,
          successorTaskId: d.successorTaskId,
          dependencyType: d.dependencyType,
          lagDays: d.lagDays,
        })),
        depOverrides
      );

      // Calculate CPM
      const cpmResult = calculateCPM(workingTasks, workingDeps);

      // Get project info for key dates
      const projectInfo = await storage.getProjectInfo(decodedName);

      res.json({
        scenario,
        tasks: cpmResult.tasks,
        dependencies: workingDeps,
        criticalPath: cpmResult.criticalPath,
        projectFinish: cpmResult.projectFinish,
        hasCircularDependency: cpmResult.hasCircularDependency,
        warnings: cpmResult.warnings,
        keyDates: {
          pdHandoverDate: projectInfo?.pdHandoverDate || null,
          constructionStartDate: projectInfo?.constructionStartDate || null,
          commissioningDate: projectInfo?.commissioningDate || null,
          omHandoverDate: projectInfo?.omHandoverDate || null,
          clientHandoverDate: projectInfo?.clientHandoverDate || null,
        },
        overrideCounts: {
          taskOverrides: taskOverrides.filter(o => o.deletedFlag !== 1).length,
          dependencyOverrides: depOverrides.filter(o => o.deletedFlag !== 1).length,
        },
      });
    } catch (error: any) {
      console.error("Error getting working plan:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Reset working plan to baseline
  app.post("/api/projects/:projectName/working-plan/reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);

      const scenario = await storage.getActiveScenario(decodedName);
      if (scenario) {
        await storage.resetScenario(scenario.id);
      }

      logAuditFromReq(req, { entityType: "working_plan", action: "reset", projectName, changesJson: { description: "Working plan reset to baseline" } });
      res.json({ success: true, message: "Working plan reset to baseline" });
    } catch (error: any) {
      console.error("Error resetting working plan:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Update a task in working plan
  app.patch("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { taskId } = req.params;
      const { projectName, startDate, endDate, name, taskNo, comment, percentComplete } = req.body;

      if (!projectName) {
        return res.status(400).json({ error: "validation_error", message: "projectName is required" });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);
      const id = parseInt(taskId);

      const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
      const existing = existingOverrides.find(o => o.importedTaskId === id);

      let result;
      if (existing) {
        result = await storage.updateTaskOverride(existing.id, {
          overrideStartDate: startDate || existing.overrideStartDate,
          overrideEndDate: endDate || existing.overrideEndDate,
          overrideName: name || existing.overrideName,
          overrideTaskNo: taskNo || existing.overrideTaskNo,
          overrideComment: comment || existing.overrideComment,
        });
      } else {
        result = await storage.createTaskOverride({
          scenarioId: scenario.id,
          importedTaskId: id,
          overrideStartDate: startDate || null,
          overrideEndDate: endDate || null,
          overrideName: name || null,
          overrideTaskNo: taskNo || null,
          overrideComment: comment || null,
          deletedFlag: 0,
          isNewTask: 0,
        });
      }

      if (percentComplete !== undefined && percentComplete !== null) {
        const parsed = parseInt(String(percentComplete));
        if (isNaN(parsed) || parsed < 0 || parsed > 100) {
          return res.status(400).json({ error: "BAD_REQUEST", message: "percentComplete must be between 0 and 100" });
        }
        const pctVal = parsed / 100;
        try {
          const result = await db.update(workItems).set({ percentComplete: pctVal }).where(
            and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, id))
          ).returning({ id: workItems.id });
          if (result.length === 0) {
            const wiByProject = await db.execute(sql`
              SELECT wi.id, wi.title, pi.project_name
              FROM work_items wi
              JOIN project_info pi ON wi.project_id = pi.id
              WHERE wi.legacy_table = 'project_plan' AND wi.legacy_id = ${id} AND wi.deleted_at IS NULL
              LIMIT 1
            `);
            if (wiByProject.rows.length > 0) {
              await db.update(workItems).set({ percentComplete: pctVal }).where(
                eq(workItems.id, (wiByProject.rows[0] as any).id)
              );
            }
          }
        } catch (e) {
          console.warn(`[working-plan] Failed to sync percentComplete to work_items for task ${id}:`, e);
        }
      }

      logAuditFromReq(req, { entityType: "working_plan_task", action: "update", entityId: String(id), projectName, changesJson: { description: "Working plan task updated", startDate, endDate, name, taskNo } });
      res.json(result);

      try {
        // Notifications feature removed - financial impact notification inserts are now no-ops
      } catch (crossErr: any) {
        console.warn("[fin-cross] Plan-to-financial notification failed:", crossErr.message);
      }
    } catch (error: any) {
      console.error("Error updating task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Create new task in working plan
  app.post("/api/working-plan/tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, startDate, endDate, name, taskNo } = req.body;

      if (!projectName || !startDate || !endDate || !name) {
        return res.status(400).json({ 
          error: "validation_error", 
          message: "projectName, startDate, endDate, and name are required" 
        });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);

      const created = await storage.createTaskOverride({
        scenarioId: scenario.id,
        importedTaskId: null,
        overrideStartDate: startDate,
        overrideEndDate: endDate,
        overrideName: name,
        overrideTaskNo: taskNo || null,
        overrideComment: null,
        deletedFlag: 0,
        isNewTask: 1,
      });

      logAuditFromReq(req, { entityType: "working_plan_task", action: "create", projectName, changesJson: { description: "Working plan task created", name, startDate, endDate } });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  app.post("/api/projects/:projectName/working-plan/renumber-wbs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const scenario = await storage.getOrCreateActiveScenario(decodedName);
      const baseTasks = await storage.getProjectPlansByProject(decodedName);
      const taskOverrides = await storage.getTaskOverridesByScenario(scenario.id);
      const workingTasks = applyOverridesToTasks(
        baseTasks.map(t => ({
          id: t.id,
          taskNo: t.taskNo,
          name: t.highLevelProgramme,
          startDate: t.actualStart,
          endDate: t.actualEnd,
          type: null,
          percentComplete: t.actualPctComplete ?? null,
          isBaseline: true,
        })),
        taskOverrides
      );

      let wbsNum = 1;
      for (const task of workingTasks) {
        const newWbs = String(wbsNum);
        const absId = Math.abs(task.id);
        if (task.id < 0) {
          const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
          const existing = existingOverrides.find(o => o.id === absId && o.isNewTask === 1);
          if (existing) {
            await storage.updateTaskOverride(existing.id, { overrideTaskNo: newWbs });
          }
        } else {
          const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
          const existing = existingOverrides.find(o => o.importedTaskId === task.id);
          if (existing) {
            await storage.updateTaskOverride(existing.id, { overrideTaskNo: newWbs });
          } else {
            await storage.createTaskOverride({
              scenarioId: scenario.id,
              importedTaskId: task.id,
              overrideStartDate: null,
              overrideEndDate: null,
              overrideName: null,
              overrideTaskNo: newWbs,
              overrideComment: null,
              deletedFlag: 0,
              isNewTask: 0,
            });
          }
        }
        wbsNum++;
      }

      logAuditFromReq(req, { entityType: "working_plan", action: "renumber_wbs", projectName: decodedName, changesJson: { totalTasks: workingTasks.length } });
      res.json({ success: true, totalRenamed: workingTasks.length });
    } catch (error: any) {
      console.error("Error renumbering WBS:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Delete task from working plan (soft delete)
  app.delete("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { taskId } = req.params;
      const { projectName, isBaseline, isNewTask } = req.body;

      if (!projectName) {
        return res.status(400).json({ error: "validation_error", message: "projectName is required" });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);
      const id = parseInt(taskId);
      const absId = Math.abs(id);
      const isImported = isBaseline === true || id < 0;

      if (isImported) {
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find(o => o.importedTaskId === absId);

        if (existing) {
          await storage.softDeleteTaskOverride(existing.id);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: absId,
            overrideStartDate: null,
            overrideEndDate: null,
            overrideName: null,
            overrideTaskNo: null,
            overrideComment: null,
            deletedFlag: 1,
            isNewTask: 0,
          });
        }
      } else {
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existingOverride = existingOverrides.find(o => o.id === absId && o.isNewTask === 1);
        if (existingOverride) {
          await storage.softDeleteTaskOverride(existingOverride.id);
        } else {
          // GC-002: Use soft-delete instead of hard-delete for data recovery
          await db.update(workItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(workItems.id, absId));
        }
      }

      logAuditFromReq(req, { entityType: "working_plan_task", action: "delete", entityId: taskId, projectName, changesJson: { description: "Working plan task deleted", isImported } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Create dependency
  app.post("/api/projects/:projectName/dependencies", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const { predecessorTaskId, successorTaskId, dependencyType, lagDays } = req.body;

      if (!predecessorTaskId || !successorTaskId) {
        return res.status(400).json({ 
          error: "validation_error", 
          message: "predecessorTaskId and successorTaskId are required" 
        });
      }

      const predId = parseInt(predecessorTaskId);
      const succId = parseInt(successorTaskId);

      if (predId === succId) {
        return res.status(400).json({
          error: "validation_error",
          message: "A task cannot depend on itself"
        });
      }

      const validTypes = ["FS", "SS", "FF", "SF"];
      const depType = dependencyType || "FS";
      if (!validTypes.includes(depType)) {
        return res.status(400).json({
          error: "validation_error",
          message: "Invalid dependency type. Must be FS, SS, FF, or SF"
        });
      }

      const lag = parseInt(lagDays) || 0;
      if (lag < -365 || lag > 365) {
        return res.status(400).json({
          error: "validation_error",
          message: "Lag days must be between -365 and 365"
        });
      }

      const existingDeps = await storage.getDependenciesByProject(decodedName);
      
      const visited = new Set<number>();
      const checkCycle = (taskId: number, target: number): boolean => {
        if (taskId === target) return true;
        if (visited.has(taskId)) return false;
        visited.add(taskId);
        
        const successorDeps = existingDeps.filter(d => d.predecessorTaskId === taskId);
        for (const dep of successorDeps) {
          if (checkCycle(dep.successorTaskId, target)) return true;
        }
        return false;
      };
      
      if (checkCycle(succId, predId)) {
        return res.status(400).json({
          error: "validation_error",
          message: "This dependency would create a circular reference"
        });
      }

      const created = await storage.createDependency({
        projectName: decodedName,
        predecessorTaskId: predId,
        successorTaskId: succId,
        dependencyType: depType,
        lagDays: lag,
      });

      logAuditFromReq(req, { entityType: "dependency", action: "create", entityId: String(created.id), projectName: decodedName, changesJson: { description: "Dependency created", predecessorTaskId: predId, successorTaskId: succId, dependencyType: depType, lagDays: lag } });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating dependency:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Delete dependency
  app.delete("/api/dependencies/:depId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const depId = parseInt(req.params.depId);
      if (isNaN(depId)) return res.status(400).json({ error: "Invalid dependency ID" });
      await storage.deleteDependency(depId);
      logAuditFromReq(req, { entityType: "dependency", action: "delete", entityId: depId, changesJson: { description: "Dependency deleted" } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting dependency:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Get schedule change notices
  app.get("/api/projects/:projectName/change-notices", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const notices = await storage.getChangeNoticesByProject(decodedName);
      res.json(notices);
    } catch (error: any) {
      console.error("Error getting change notices:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Create schedule change notice
  app.post("/api/projects/:projectName/change-notices", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);
      const { summary, oldFinishDate, newFinishDate, changedTasks, criticalPathDelta, userNote, createdBy } = req.body;

      if (!summary) {
        return res.status(400).json({ error: "validation_error", message: "summary is required" });
      }

      const created = await storage.createChangeNotice({
        projectName: decodedName,
        summary,
        oldFinishDate: oldFinishDate || null,
        newFinishDate: newFinishDate || null,
        changedTasks: changedTasks || null,
        criticalPathDelta: criticalPathDelta || null,
        userNote: userNote || null,
        clientNotified: 0,
        documentationUpdated: 0,
        createdBy: createdBy || null,
      });

      logAuditFromReq(req, { entityType: "change_notice", action: "create", entityId: String(created.id), projectName: decodedName, changesJson: { description: "Change notice created", summary, oldFinishDate, newFinishDate, criticalPathDelta } });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating change notice:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Update schedule change notice (mark as notified/documented)
  app.patch("/api/change-notices/:noticeId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const noticeId = parseInt(req.params.noticeId);
      if (isNaN(noticeId)) return res.status(400).json({ error: "Invalid notice ID" });
      const { clientNotified, documentationUpdated, userNote } = req.body;

      const updated = await storage.updateChangeNotice(noticeId, {
        clientNotified: clientNotified !== undefined ? clientNotified : undefined,
        documentationUpdated: documentationUpdated !== undefined ? documentationUpdated : undefined,
        userNote: userNote !== undefined ? userNote : undefined,
      });

      if (!updated) {
        return res.status(404).json({ error: "not_found", message: "Change notice not found" });
      }

      logAuditFromReq(req, { entityType: "change_notice", action: "update", entityId: noticeId, changesJson: { description: "Change notice updated", clientNotified, documentationUpdated, userNote } });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating change notice:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

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

  // =========================================================================
  // COS CONTROL TOWER APIs
  // =========================================================================

  app.get("/api/cos-control/summary", requireAuth, requireAdmin, async (req, res) => {
    try {
      const legacyExp = await storage.getAllProgramExpenses();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const lines = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = parseFloat(e.expenseActualTotal || e.budgetTotal || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          amount: Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0')),
          state: e.computedState || classifyExpenseState(e),
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          invoicedDate: e.expenseInvoicedDate,
          paymentDate: e.expensePaymentDate,
          forecastPaymentDate: e.computedForecastPaymentDate,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
        }));

      const summary = aggregateCOS(lines as any);
      res.json(summary);
    } catch (err: any) {
      console.error('[COS Control] summary error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/by-project", requireAuth, requireAdmin, async (req, res) => {
    try {
      const legacyExp = await storage.getAllProgramExpenses();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const lines = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = parseFloat(e.expenseActualTotal || e.budgetTotal || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          amount: Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0')),
          state: e.computedState || classifyExpenseState(e),
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          invoicedDate: e.expenseInvoicedDate,
          paymentDate: e.expensePaymentDate,
          forecastPaymentDate: e.computedForecastPaymentDate,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
        }));

      const byProject = aggregateCOSByProject(lines as any);
      res.json(byProject);
    } catch (err: any) {
      console.error('[COS Control] by-project error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/lines", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { project, state, supplier, search } = req.query;
      const legacyExp = await storage.getAllProgramExpenses();
      let expenses = (await getMergedExpensesAndInflows(legacyExp, [])).expenses;

      let lines = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = parseFloat(e.expenseActualTotal || e.budgetTotal || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          hash: e.expenseLineHash,
          projectName: e.projectName,
          category: e.expenseCategory,
          lineItem: e.expenseLineItem,
          budgetTotal: parseFloat(e.budgetTotal || '0'),
          actualTotal: parseFloat(e.expenseActualTotal || '0'),
          state: e.computedState || classifyExpenseState(e),
          poNumber: e.expensePoNumber,
          invoiceNumber: e.expenseInvoiceNumber,
          invoicedDate: e.expenseInvoicedDate,
          paymentDate: e.expensePaymentDate,
          forecastPaymentDate: e.computedForecastPaymentDate,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
        }));

      if (project) lines = lines.filter((l: any) => l.projectName === project);
      if (state) lines = lines.filter((l: any) => l.state === state);
      if (supplier) lines = lines.filter((l: any) => l.supplierName === supplier);
      if (search) {
        const q = String(search).toLowerCase();
        lines = lines.filter((l: any) =>
          (l.lineItem && l.lineItem.toLowerCase().includes(q)) ||
          (l.invoiceNumber && l.invoiceNumber.toLowerCase().includes(q)) ||
          (l.poNumber && l.poNumber.toLowerCase().includes(q)) ||
          (l.supplierName && l.supplierName.toLowerCase().includes(q))
        );
      }

      res.json({ lines, total: lines.length });
    } catch (err: any) {
      console.error('[COS Control] lines error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/invoices", requireAuth, requireAdmin, async (req, res) => {
    try {
      const legacyExp = await storage.getAllProgramExpenses();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const invoiceMap = new Map<string, any>();

      for (const e of expenses) {
        if (!e.expenseInvoiceNumber || !e.expenseInvoiceNumber.trim()) continue;
        const inv = e.expenseInvoiceNumber.trim();
        if (!invoiceMap.has(inv)) {
          invoiceMap.set(inv, {
            invoiceNumber: inv,
            totalAmount: 0,
            projects: new Set<string>(),
            state: e.computedState || classifyExpenseState(e),
            invoicedDate: e.expenseInvoicedDate,
            paymentDate: e.expensePaymentDate,
            supplierName: e.supplierName,
            lineCount: 0,
          });
        }
        const entry = invoiceMap.get(inv)!;
        entry.totalAmount += Math.abs(parseFloat(e.expenseActualTotal || '0'));
        entry.projects.add(e.projectName);
        entry.lineCount++;
      }

      const invoices = Array.from(invoiceMap.values()).map(i => ({
        ...i,
        projects: Array.from(i.projects),
      })).sort((a, b) => b.totalAmount - a.totalAmount);

      res.json({ invoices, total: invoices.length });
    } catch (err: any) {
      console.error('[COS Control] invoices error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/pos", requireAuth, requireAdmin, async (req, res) => {
    try {
      const legacyExp = await storage.getAllProgramExpenses();
      const { expenses } = await getMergedExpensesAndInflows(legacyExp, []);
      const poMap = new Map<string, any>();

      for (const e of expenses) {
        if (!e.expensePoNumber || !e.expensePoNumber.trim()) continue;
        const po = e.expensePoNumber.trim();
        if (!poMap.has(po)) {
          poMap.set(po, {
            poNumber: po,
            totalAmount: 0,
            projects: new Set<string>(),
            invoiceNumbers: new Set<string>(),
            supplierName: e.supplierName,
            lineCount: 0,
          });
        }
        const entry = poMap.get(po)!;
        entry.totalAmount += Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
        entry.projects.add(e.projectName);
        if (e.expenseInvoiceNumber) entry.invoiceNumbers.add(e.expenseInvoiceNumber);
        entry.lineCount++;
      }

      const pos = Array.from(poMap.values()).map(p => ({
        ...p,
        projects: Array.from(p.projects),
        invoiceNumbers: Array.from(p.invoiceNumbers),
      })).sort((a, b) => b.totalAmount - a.totalAmount);

      res.json({ pos, total: pos.length });
    } catch (err: any) {
      console.error('[COS Control] POs error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // CASHFLOW FORECAST APIs
  // =========================================================================

  app.get("/api/cashflow-forecast/weekly", requireAuth, requireAdmin, async (req, res) => {
    try {

      const weeks = parseInt(String(req.query.weeks || '52'));
      const startDate = String(req.query.start || new Date().toISOString().split('T')[0]);

      const [legacyExp, legacyInf, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedForecast = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const expenses = mergedForecast.expenses;
      const resolvedInflows = resolveInflowEffectiveDates(mergedForecast.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const outflowLines: CashflowLineItem[] = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = parseFloat(e.expenseActualTotal || e.budgetTotal || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          type: 'outflow' as const,
          amount: Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0')),
          actualDate: e.expensePaymentDate || null,
          forecastDate: e.computedForecastPaymentDate || null,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
          description: e.expenseLineItem || e.expenseCategory || 'Unknown',
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          category: e.expenseCategory,
          supplierName: e.supplierName,
        }));

      const inflowLines: CashflowLineItem[] = resolvedInflows
        .filter((inf: any) => {
          const amt = parseFloat(inf.milestoneAmount || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((inf: any) => ({
          id: inf.id,
          projectName: inf.projectName,
          type: 'inflow' as const,
          amount: Math.abs(parseFloat(inf.milestoneAmount || '0')),
          actualDate: inf.paymentReceivedDate || null,
          forecastDate: inf.effectiveDate !== inf.paymentReceivedDate ? inf.effectiveDate : (inf.computedForecastReceiptDate || null),
          confidence: scoreInflowConfidence(inf),
          assumptionDriver: inf.paymentReceivedDate ? 'Actual receipt' : (inf.effectiveDate !== inf.computedForecastReceiptDate && inf.effectiveDate !== inf.plannedPaymentDate ? 'Override/linked task' : (inf.invoiceRaisedDate ? 'Invoice raised + terms' : 'Planned date')),
          description: inf.milestoneName || 'Revenue milestone',
          invoiceNumber: inf.milestoneInvoiceNumber,
          poNumber: null,
          category: 'Revenue',
          supplierName: null,
        }));

      const weeklyData = computeWeeklyCashflow(inflowLines, outflowLines, startDate, weeks);
      res.json({ weeks: weeklyData, totalInflows: inflowLines.length, totalOutflows: outflowLines.length });
    } catch (err: any) {
      console.error('[Cashflow Forecast] weekly error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cashflow-forecast/week-detail", requireAuth, requireAdmin, async (req, res) => {
    try {

      const weekStart = String(req.query.weekStart);
      const weekEnd = String(req.query.weekEnd);

      if (!weekStart || !weekEnd) {
        return res.status(400).json({ error: 'weekStart and weekEnd required' });
      }

      const [legacyExp2, legacyInf2, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedWeekDetail = await getMergedExpensesAndInflows(legacyExp2, legacyInf2);
      const resolvedInflows = resolveInflowEffectiveDates(mergedWeekDetail.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      const outflowLines: CashflowLineItem[] = mergedWeekDetail.expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .filter((e: any) => {
          const amt = parseFloat(e.expenseActualTotal || e.budgetTotal || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          type: 'outflow' as const,
          amount: Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0')),
          actualDate: e.expensePaymentDate || null,
          forecastDate: e.computedForecastPaymentDate || null,
          confidence: scoreExpenseConfidence(e),
          assumptionDriver: getAssumptionDriver(e, 30),
          description: e.expenseLineItem || e.expenseCategory || 'Unknown',
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          category: e.expenseCategory,
          supplierName: e.supplierName,
        }));

      const inflowLines: CashflowLineItem[] = resolvedInflows
        .filter((inf: any) => {
          const amt = parseFloat(inf.milestoneAmount || '0');
          return !isNaN(amt) && amt !== 0;
        })
        .map((inf: any) => ({
          id: inf.id,
          projectName: inf.projectName,
          type: 'inflow' as const,
          amount: Math.abs(parseFloat(inf.milestoneAmount || '0')),
          actualDate: inf.paymentReceivedDate || null,
          forecastDate: inf.effectiveDate !== inf.paymentReceivedDate ? inf.effectiveDate : (inf.computedForecastReceiptDate || null),
          confidence: scoreInflowConfidence(inf),
          assumptionDriver: inf.paymentReceivedDate ? 'Actual receipt' : (inf.invoiceRaisedDate ? 'Invoice raised + terms' : 'Planned date'),
          description: inf.milestoneName || 'Revenue milestone',
          invoiceNumber: inf.milestoneInvoiceNumber,
          poNumber: null,
          category: 'Revenue',
          supplierName: null,
        }));

      const allLines = [...inflowLines, ...outflowLines];
      const weekLines = getLinesForWeek(allLines, weekStart, weekEnd);
      res.json({ lines: weekLines, total: weekLines.length });
    } catch (err: any) {
      console.error('[Cashflow Forecast] week-detail error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // DATA QUALITY APIs
  // =========================================================================

  app.get("/api/data-quality/scan", requireAuth, requireAdmin, async (req, res) => {
    try {

      const legacyExpDQ = await storage.getAllProgramExpenses();
      const legacyInfDQ = await storage.getAllProgramInflows();
      const mergedDQ = await getMergedExpensesAndInflows(legacyExpDQ, legacyInfDQ);
      const expenses = mergedDQ.expenses;
      const inflows = mergedDQ.inflows;
      const projects = await db.select().from(projectInfo);

      const expenseInputs = expenses
        .filter((e: any) => e.rowType === 'item' || !e.rowType)
        .map((e: any) => ({
          id: e.id,
          projectName: e.projectName,
          expenseCategory: e.expenseCategory,
          expenseLineItem: e.expenseLineItem,
          expenseActualTotal: e.expenseActualTotal,
          expenseInvoiceNumber: e.expenseInvoiceNumber,
          expenseInvoicedDate: e.expenseInvoicedDate,
          expensePaymentDate: e.expensePaymentDate,
          expensePoNumber: e.expensePoNumber,
          supplierName: e.supplierName,
        }));

      const inflowInputs = inflows.map((inf: any) => ({
        id: inf.id,
        projectName: inf.projectName,
        milestoneName: inf.milestoneName,
        milestoneAmount: inf.milestoneAmount,
        milestoneInvoiceNumber: inf.milestoneInvoiceNumber,
        invoiceRaisedDate: inf.invoiceRaisedDate,
        paymentReceivedDate: inf.paymentReceivedDate,
      }));

      const projectInputs = projects.map((p: any) => ({
        projectName: p.projectName,
        pm: p.pm,
        constructionStartDate: p.constructionStartDate,
        commissioningDate: p.commissioningDate,
      }));

      const issues = runDataQualityChecks(expenseInputs, inflowInputs, projectInputs);
      const errorCount = issues.filter(i => i.severity === 'Error').reduce((s, i) => s + i.count, 0);
      const warningCount = issues.filter(i => i.severity === 'Warning').reduce((s, i) => s + i.count, 0);
      const infoCount = issues.filter(i => i.severity === 'Info').reduce((s, i) => s + i.count, 0);

      res.json({
        issues,
        summary: { errorCount, warningCount, infoCount, totalIssues: errorCount + warningCount + infoCount },
      });
    } catch (err: any) {
      console.error('[Data Quality] scan error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // BACKFILL TRIGGER
  // =========================================================================

  app.post("/api/admin/backfill", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { runBackfill } = await import("./lib/backfill");
      await runBackfill();
      logAuditFromReq(req, { entityType: "system", action: "backfill", source: "SYSTEM" });
      res.json({ success: true, message: 'Backfill completed' });
    } catch (err: any) {
      console.error('[Admin] backfill error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/backfill-invoice-confirmed", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { backfillInvoiceDateConfirmed } = await import("./backfillInvoiceConfirmed");
      const result = await backfillInvoiceDateConfirmed();
      console.log('[Admin] Invoice date confirmed backfill:', result);
      logAuditFromReq(req, { entityType: "system", action: "backfill_invoice_confirmed", source: "SYSTEM", changesJson: result });
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[Admin] invoice confirmed backfill error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // PLANNING BOARD APIs
  // =========================================================================

  app.get("/api/planning-board/pm-capacity", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projects = await db.select().from(projectInfo);

      const pms = new Map<string, { pm: string; projects: { projectName: string; start: string | null; end: string | null; phase: string | null }[] }>();

      for (const p of projects) {
        const pmName = (p as any).pm || "Unassigned";
        if (!pms.has(pmName)) {
          pms.set(pmName, { pm: pmName, projects: [] });
        }
        pms.get(pmName)!.projects.push({
          projectName: p.projectName,
          start: (p as any).constructionStartDate,
          end: (p as any).commissioningDate,
          phase: (p as any).phase,
        });
      }

      const startDate = new Date(2025, 8, 1);
      const weeks: string[] = [];
      for (let i = 0; i < 52; i++) {
        const wk = new Date(startDate);
        wk.setDate(wk.getDate() + i * 7);
        weeks.push(wk.toISOString().split('T')[0]);
      }

      const heatmap = Array.from(pms.values()).map(entry => {
        const weekCounts = weeks.map(weekStart => {
          const ws = new Date(weekStart);
          const we = new Date(ws);
          we.setDate(we.getDate() + 7);
          let count = 0;
          for (const proj of entry.projects) {
            if (!proj.start && !proj.end) continue;
            const ps = proj.start ? new Date(proj.start) : new Date(0);
            const pe = proj.end ? new Date(proj.end) : new Date(2030, 0, 1);
            if (ps < we && pe > ws) count++;
          }
          return count;
        });
        return {
          pm: entry.pm,
          projectCount: entry.projects.length,
          weekCounts,
        };
      }).sort((a, b) => b.projectCount - a.projectCount);

      res.json({ weeks, heatmap });
    } catch (err: any) {
      console.error('[Planning Board] capacity error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/planning-board/projects", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projects = await db.select().from(projectInfo);
      const legacyExpPB = await storage.getAllProgramExpenses();
      const legacyInfPB = await storage.getAllProgramInflows();
      const mergedPB = await getMergedExpensesAndInflows(legacyExpPB, legacyInfPB);
      const expenses = mergedPB.expenses;
      const inflows = mergedPB.inflows;

      const projectData = projects.map((p: any) => {
        const projExpenses = expenses.filter((e: any) => e.projectName === p.projectName && (e.rowType === 'item' || !e.rowType));
        const projInflows = inflows.filter((inf: any) => inf.projectName === p.projectName);

        const totalBudget = projExpenses.reduce((sum: number, e: any) => sum + Math.abs(parseFloat(e.budgetTotal || '0')), 0);
        const totalActual = projExpenses.reduce((sum: number, e: any) => sum + Math.abs(parseFloat(e.expenseActualTotal || '0')), 0);
        const totalRevenue = projInflows.reduce((sum: number, inf: any) => sum + Math.abs(parseFloat(inf.milestoneAmount || '0')), 0);
        const totalReceived = projInflows
          .filter((inf: any) => inf.paymentReceivedDate)
          .reduce((sum: number, inf: any) => sum + Math.abs(parseFloat(inf.milestoneAmount || '0')), 0);

        const riskFlags: string[] = [];
        if (totalActual > totalBudget * 1.1 && totalBudget > 0) riskFlags.push('Over costed');
        if (!p.constructionStartDate) riskFlags.push('No start date');
        if (!p.commissioningDate) riskFlags.push('No commissioning date');
        if (!p.pm) riskFlags.push('No PM assigned');
        if (totalReceived === 0 && totalRevenue > 0) riskFlags.push('No revenue received');

        return {
          projectName: p.projectName,
          pm: p.pm,
          phase: p.phase,
          sizeKwp: p.sizeKwp,
          constructionStartDate: p.constructionStartDate,
          commissioningDate: p.commissioningDate,
          totalBudget,
          totalActual,
          totalRevenue,
          totalReceived,
          budgetVariance: totalBudget > 0 ? ((totalActual - totalBudget) / totalBudget * 100) : 0,
          revenueRealized: totalRevenue > 0 ? (totalReceived / totalRevenue * 100) : 0,
          expenseLineCount: projExpenses.length,
          inflowLineCount: projInflows.length,
          riskFlags,
        };
      }).sort((a: any, b: any) => b.riskFlags.length - a.riskFlags.length);

      res.json({ projects: projectData, total: projectData.length });
    } catch (err: any) {
      console.error('[Planning Board] projects error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ SCENARIO ENGINE API ============

  app.get("/api/scenarios", requireAuth, requireAdmin, async (req, res) => {
    try {
      const all = await storage.getAllScenarios();
      res.json({ scenarios: all });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scenarios", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const userId = (req.user as any)?.id;
      const scenario = await storage.createScenario({ name, description, createdBy: userId, isDefault: false });
      logAuditFromReq(req, { entityType: "scenario", action: "create", entityId: String(scenario.id), changesJson: { description: "Scenario created", name } });
      res.json(scenario);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scenarios/:id/duplicate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const dup = await storage.duplicateScenario(id, name);
      logAuditFromReq(req, { entityType: "scenario", action: "duplicate", entityId: String(id), changesJson: { description: "Scenario duplicated", sourceId: id, newName: name } });
      res.json(dup);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/scenarios/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteScenario(id);
      logAuditFromReq(req, { entityType: "scenario", action: "delete", entityId: String(id), changesJson: { description: "Scenario deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scenarios/:id/reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.clearDateOverrides(id);
      logAuditFromReq(req, { entityType: "scenario", action: "reset", entityId: String(id), changesJson: { description: "Scenario date overrides cleared" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ SCENARIO-AWARE COS CONTROL API ============

  app.get("/api/cos-control/scenario-monthly", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const legacyExpSM = await storage.getAllProgramExpenses();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSM, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const cosLines: any[] = items.map((e: any) => ({
        id: e.id,
        projectName: e.projectName,
        expenseCategory: e.expenseCategory,
        expenseLineItem: e.expenseLineItem,
        amount: Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0')),
        state: e.computedState || classifyExpenseState(e),
        invoiceNumber: e.expenseInvoiceNumber,
        poNumber: e.expensePoNumber,
        invoicedDate: e.expenseInvoicedDate,
        paymentDate: e.expensePaymentDate,
        forecastPaymentDate: e.computedForecastPaymentDate || e.forecastPaymentDate,
        supplierName: e.supplierName,
        confidence: scoreExpenseConfidence(e),
        assumptionDriver: getAssumptionDriver(e),
        hash: e.expenseLineHash,
      }));

      let scenarioLines = cosLines;
      let baselineMonthly = computeMonthlyBuckets(cosLines);

      if (scenarioId) {
        const overrideMap = new Map();
        scenarioLines = cosLines;
      }

      const scenarioMonthly = computeMonthlyBuckets(scenarioLines);

      const allMonths = new Set([...baselineMonthly.keys(), ...scenarioMonthly.keys()]);
      const sortedMonths = Array.from(allMonths).sort();

      const monthlyData = sortedMonths.map(month => {
        const baseline = baselineMonthly.get(month) || { planned: 0, committed: 0, invoiced: 0, paid: 0 };
        const scenario = scenarioMonthly.get(month) || { planned: 0, committed: 0, invoiced: 0, paid: 0 };
        const baseTotal = baseline.planned + baseline.committed + baseline.invoiced + baseline.paid;
        const scenTotal = scenario.planned + scenario.committed + scenario.invoiced + scenario.paid;
        return {
          month,
          ...scenario,
          total: scenTotal,
          baselinePlanned: baseline.planned,
          baselineCommitted: baseline.committed,
          baselineInvoiced: baseline.invoiced,
          baselinePaid: baseline.paid,
          baselineTotal: baseTotal,
          delta: scenTotal - baseTotal,
        };
      });

      const summary = aggregateCOS(scenarioLines);

      res.json({ monthly: monthlyData, summary, lineCount: scenarioLines.length });
    } catch (err: any) {
      console.error('[COS Control Scenario Monthly]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/tracker", requireAuth, async (req, res) => {
    try {
      const [legacyExp, legacyInf] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
      ]);
      const mergedData = await getMergedExpensesAndInflows(legacyExp, legacyInf);
      const allExpenses = mergedData.expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const monthMap = new Map<string, { planned: number; realised: number; budget: number }>();

      for (const e of items) {
        const actualAmt = parseFloat(e.expenseActualTotal || '0');
        const budgetAmt = parseFloat(e.budgetTotal || '0');

        const dateStr = e.expenseInvoicedDate || e.expensePaymentDate;
        if (!dateStr && actualAmt === 0 && budgetAmt === 0) continue;

        let monthKey = '';
        if (dateStr) {
          const dateMatch = (dateStr as string).match(/^(\d{4})-(\d{2})/);
          if (dateMatch) {
            monthKey = `${dateMatch[1]}-${dateMatch[2]}`;
          }
        }
        if (!monthKey && actualAmt === 0 && budgetAmt === 0) continue;
        if (!monthKey) monthKey = 'undated';

        if (!monthMap.has(monthKey)) {
          monthMap.set(monthKey, { planned: 0, realised: 0, budget: 0 });
        }
        const bucket = monthMap.get(monthKey)!;

        if (actualAmt !== 0) {
          bucket.planned += actualAmt;

          const _nw = new Date();
          const _cmk = `${_nw.getFullYear()}-${String(_nw.getMonth() + 1).padStart(2, '0')}`;
          if (isCosRealisedCheck(e) && monthKey <= _cmk) {
            bucket.realised += actualAmt;
          }
        }

        if (budgetAmt !== 0) {
          bucket.budget += budgetAmt;
        }
      }

      const months = Array.from(monthMap.entries())
        .filter(([k]) => k !== 'undated')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          planned: data.planned,
          realised: data.realised,
          outstanding: data.planned - data.realised,
          budget: data.budget,
        }));

      const undated = monthMap.get('undated');

      const totals = {
        planned: months.reduce((s, m) => s + m.planned, 0) + (undated?.planned || 0),
        realised: months.reduce((s, m) => s + m.realised, 0) + (undated?.realised || 0),
        outstanding: 0,
        budget: months.reduce((s, m) => s + m.budget, 0) + (undated?.budget || 0),
      };
      totals.outstanding = totals.planned - totals.realised;

      res.json({ months, totals, lineCount: items.length });
    } catch (err: any) {
      console.error('[COS Tracker]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cashflow-tracker", requireAuth, async (req, res) => {
    try {
      const [legacyExpCF, legacyInflowsCF, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedCF = await getMergedExpensesAndInflows(legacyExpCF, legacyInflowsCF);
      const allInflows = resolveInflowEffectiveDates(mergedCF.inflows, allTaskLinks, allOpTasks, allPlanTasks);
      const items = mergedCF.expenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const weekMap = new Map<string, {
        inflows: number; confirmedInflows: number;
        outflows: number; confirmedOutflows: number;
        invoicedPayments: number;
      }>();

      function getWeekStart(dateStr: string): string | null {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
        return monday.toISOString().split('T')[0];
      }

      for (const e of items) {
        const amt = parseFloat(e.expenseActualTotal || '0');
        if (amt === 0) continue;

        const payDate = e.expensePaymentDate || e.forecastPaymentDate;
        if (!payDate) continue;
        const wk = getWeekStart(payDate);
        if (!wk) continue;

        if (!weekMap.has(wk)) weekMap.set(wk, { inflows: 0, confirmedInflows: 0, outflows: 0, confirmedOutflows: 0, invoicedPayments: 0 });
        const bucket = weekMap.get(wk)!;
        const isConfirmedOutflow = e.paymentDateFontColor === 'black';
        if (isConfirmedOutflow) {
          bucket.confirmedOutflows += amt;
        } else {
          bucket.outflows += amt;
        }

        const _nw2 = new Date();
        const _cmk2 = `${_nw2.getFullYear()}-${String(_nw2.getMonth() + 1).padStart(2, '0')}`;
        const _wkMonth = wk.substring(0, 7);
        if (isCosRealisedCheck(e) && _wkMonth <= _cmk2) {
          bucket.invoicedPayments += amt;
        }
      }

      for (const inf of allInflows) {
        const amt = parseFloat(inf.milestoneAmount || '0');
        if (amt === 0) continue;

        const dateStr = inf.paymentReceivedDate || (inf as any).effectiveDate || inf.plannedPaymentDate;
        if (!dateStr) continue;
        const wk = getWeekStart(dateStr);
        if (!wk) continue;

        if (!weekMap.has(wk)) weekMap.set(wk, { inflows: 0, confirmedInflows: 0, outflows: 0, confirmedOutflows: 0, invoicedPayments: 0 });
        const bucket = weekMap.get(wk)!;
        const isConfirmedInflow = !!inf.paymentReceivedDate;
        if (isConfirmedInflow) {
          bucket.confirmedInflows += amt;
        } else {
          bucket.inflows += amt;
        }
      }

      const weeks = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, data]) => ({
          weekStart,
          inflows: data.inflows,
          confirmedInflows: data.confirmedInflows,
          outflows: data.outflows,
          confirmedOutflows: data.confirmedOutflows,
          cashflow: (data.inflows + data.confirmedInflows) - (data.outflows + data.confirmedOutflows),
          invoicedPayments: data.invoicedPayments,
        }));

      const totals = {
        inflows: weeks.reduce((s, w) => s + w.inflows, 0),
        confirmedInflows: weeks.reduce((s, w) => s + w.confirmedInflows, 0),
        outflows: weeks.reduce((s, w) => s + w.outflows, 0),
        confirmedOutflows: weeks.reduce((s, w) => s + w.confirmedOutflows, 0),
        cashflow: 0,
        invoicedPayments: weeks.reduce((s, w) => s + w.invoicedPayments, 0),
      };
      totals.cashflow = (totals.inflows + totals.confirmedInflows) - (totals.outflows + totals.confirmedOutflows);

      res.json({ weeks, totals });
    } catch (err: any) {
      console.error('[Cashflow Tracker]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/scenario-invoices", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const search = (req.query.search as string || '').toLowerCase();
      const project = req.query.project as string || '';
      const state = req.query.state as string || '';

      const legacyExpSI = await storage.getAllProgramExpenses();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSI, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const invoiceMap = new Map<string, any>();

      for (const e of items) {
        const amount = Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
        if (amount === 0) continue;

        const lineState = e.computedState || classifyExpenseState(e);

        const entityKey = `expense_line::${e.id}`;
        const effectiveInvoiceDate = overrideMap[entityKey]?.['invoice_date'] || e.expenseInvoicedDate;
        const effectivePaymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
        const effectiveForecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;

        const cosDateStr = effectivePaymentDate || effectiveForecastDate || effectiveInvoiceDate;
        let monthBucket = '';
        if (cosDateStr) {
          const d = new Date(cosDateStr);
          if (!isNaN(d.getTime())) {
            monthBucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          }
        }

        const groupKey = e.expenseInvoiceNumber || `line_${e.id}`;

        if (!invoiceMap.has(groupKey)) {
          invoiceMap.set(groupKey, {
            id: e.id,
            invoiceNumber: e.expenseInvoiceNumber || null,
            supplierName: e.supplierName || null,
            projects: [e.projectName],
            invoicedDate: effectiveInvoiceDate,
            paymentDate: effectivePaymentDate,
            forecastPaymentDate: effectiveForecastDate,
            amount,
            state: lineState,
            monthBucket,
            poNumber: e.expensePoNumber,
            category: e.expenseCategory,
            lineItem: e.expenseLineItem,
            confidence: scoreExpenseConfidence(e),
            lineCount: 1,
            originalInvoicedDate: e.expenseInvoicedDate,
            originalPaymentDate: e.expensePaymentDate,
          });
        } else {
          const existing = invoiceMap.get(groupKey)!;
          existing.amount += amount;
          existing.lineCount++;
          if (!existing.projects.includes(e.projectName)) existing.projects.push(e.projectName);
        }
      }

      let invoices = Array.from(invoiceMap.values());

      if (search) {
        invoices = invoices.filter(inv =>
          (inv.invoiceNumber || '').toLowerCase().includes(search) ||
          (inv.supplierName || '').toLowerCase().includes(search) ||
          (inv.poNumber || '').toLowerCase().includes(search) ||
          inv.projects.some((p: string) => p.toLowerCase().includes(search))
        );
      }
      if (project) invoices = invoices.filter(inv => inv.projects.includes(project));
      if (state) invoices = invoices.filter(inv => inv.state === state);

      invoices.sort((a, b) => b.amount - a.amount);

      res.json({ invoices, total: invoices.length });
    } catch (err: any) {
      console.error('[COS Control Scenario Invoices]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/scenario-lines", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const search = (req.query.search as string || '').toLowerCase();
      const project = req.query.project as string || '';
      const state = req.query.state as string || '';

      const legacyExpSL = await storage.getAllProgramExpenses();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSL, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      let lines = items.map((e: any) => {
        const amount = Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
        const lineState = e.computedState || classifyExpenseState(e);

        const entityKey = `expense_line::${e.id}`;
        const effectiveInvoiceDate = overrideMap[entityKey]?.['invoice_date'] || e.expenseInvoicedDate;
        const effectivePaymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
        const effectiveForecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;

        const cosDateStr = effectivePaymentDate || effectiveForecastDate || effectiveInvoiceDate;
        let monthBucket = '';
        if (cosDateStr) {
          const d = new Date(cosDateStr);
          if (!isNaN(d.getTime())) {
            monthBucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          }
        }

        return {
          id: e.id,
          hash: e.expenseLineHash,
          projectName: e.projectName,
          category: e.expenseCategory,
          lineItem: e.expenseLineItem,
          amount,
          state: lineState,
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          invoicedDate: effectiveInvoiceDate,
          paymentDate: effectivePaymentDate,
          forecastPaymentDate: effectiveForecastDate,
          supplierName: e.supplierName,
          monthBucket,
          confidence: scoreExpenseConfidence(e),
          originalInvoicedDate: e.expenseInvoicedDate,
          originalPaymentDate: e.expensePaymentDate,
        };
      }).filter((l: any) => l.amount > 0);

      if (search) {
        lines = lines.filter((l: any) =>
          (l.invoiceNumber || '').toLowerCase().includes(search) ||
          (l.poNumber || '').toLowerCase().includes(search) ||
          (l.projectName || '').toLowerCase().includes(search) ||
          (l.supplierName || '').toLowerCase().includes(search) ||
          (l.lineItem || '').toLowerCase().includes(search)
        );
      }
      if (project) lines = lines.filter((l: any) => l.projectName === project);
      if (state) lines = lines.filter((l: any) => l.state === state);

      lines.sort((a: any, b: any) => b.amount - a.amount);

      res.json({ lines, total: lines.length });
    } catch (err: any) {
      console.error('[COS Control Scenario Lines]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cos-control/scenario-impact", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      if (!scenarioId) return res.json({ shifts: [], cashflowDelta: [] });

      const legacyExpSI2 = await storage.getAllProgramExpenses();
      const allExpenses = (await getMergedExpensesAndInflows(legacyExpSI2, [])).expenses;
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);
      const overrides: any[] = [];
      const overrideMap = new Map();

      const shifts: any[] = [];
      for (const ov of overrides) {
        if (ov.entityType === 'expense_line') {
          const expense = items.find((e: any) => String(e.id) === ov.entityId);
          if (expense) {
            const amount = Math.abs(parseFloat(expense.expenseActualTotal || expense.budgetTotal || '0'));
            const origDate = ov.originalDate || expense.expensePaymentDate || expense.computedForecastPaymentDate;
            const origMonth = origDate ? new Date(origDate).toISOString().slice(0, 7) : 'Unknown';
            const newMonth = new Date(ov.overrideDate).toISOString().slice(0, 7);
            if (origMonth !== newMonth) {
              shifts.push({
                entityId: ov.entityId,
                description: expense.expenseLineItem || expense.expenseInvoiceNumber || `Line #${expense.id}`,
                fromMonth: origMonth,
                toMonth: newMonth,
                amount,
              });
            }
          }
        }
      }

      shifts.sort((a, b) => b.amount - a.amount);

      res.json({ shifts: shifts.slice(0, 10), totalShifts: shifts.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ SCENARIO-AWARE CASHFLOW FORECAST API ============

  app.get("/api/cashflow-forecast/scenario-weekly", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const projectFilter = req.query.project as string || '';

      const legacyExpSW = await storage.getAllProgramExpenses();
      const legacyInfSW = await storage.getAllProgramInflows();
      const [allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedSW = await getMergedExpensesAndInflows(legacyExpSW, legacyInfSW);
      let allExpenses = mergedSW.expenses;
      let allInflows = resolveInflowEffectiveDates(mergedSW.inflows, allTaskLinks, allOpTasks, allPlanTasks);

      if (projectFilter) {
        allExpenses = allExpenses.filter((e: any) => e.projectName === projectFilter);
        allInflows = allInflows.filter((i: any) => i.projectName === projectFilter);
      }

      const expenseItems = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const buildCashflowLines = (expenses: any[], inflows: any[], overrideMap: any = {}): { inflowLines: CashflowLineItem[]; outflowLines: CashflowLineItem[] } => {
        const outflowLines: CashflowLineItem[] = expenses.map((e: any) => {
          const amount = Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
          if (amount === 0) return null;

          const entityKey = `expense_line::${e.id}`;
          const paymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
          const forecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;

          return {
            id: e.id,
            projectName: e.projectName,
            type: 'outflow' as const,
            amount,
            actualDate: paymentDate && !overrideMap[entityKey]?.['payment_date'] ? e.expensePaymentDate : null,
            forecastDate: paymentDate || forecastDate || null,
            confidence: scoreExpenseConfidence(e) as 'High' | 'Medium' | 'Low',
            assumptionDriver: getAssumptionDriver(e),
            description: e.expenseLineItem || e.expenseCategory || 'Expense',
            invoiceNumber: e.expenseInvoiceNumber,
            poNumber: e.expensePoNumber,
            category: e.expenseCategory,
            supplierName: e.supplierName,
          };
        }).filter(Boolean) as CashflowLineItem[];

        const inflowLines: CashflowLineItem[] = inflows.map((inf: any) => {
          const amount = Math.abs(parseFloat(inf.milestoneAmount || '0'));
          if (amount === 0) return null;

          const entityKey = `inflow_line::${inf.id}`;
          const scenarioReceiptDate = overrideMap[entityKey]?.['receipt_date'];
          const receiptDate = scenarioReceiptDate || inf.paymentReceivedDate;
          const forecastDate = scenarioReceiptDate || inf.effectiveDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate;

          return {
            id: inf.id,
            projectName: inf.projectName,
            type: 'inflow' as const,
            amount,
            actualDate: receiptDate && !scenarioReceiptDate ? inf.paymentReceivedDate : null,
            forecastDate: forecastDate || null,
            confidence: scoreInflowConfidence(inf) as 'High' | 'Medium' | 'Low',
            assumptionDriver: getAssumptionDriver(inf),
            description: inf.milestoneName || `Milestone ${inf.milestoneNo || ''}`,
            invoiceNumber: inf.milestoneInvoiceNumber,
            poNumber: null,
            category: 'Revenue',
            supplierName: null,
          };
        }).filter(Boolean) as CashflowLineItem[];

        return { inflowLines, outflowLines };
      };

      const manualBalances = await storage.getAllCashflowWeeklyManual();
      const openingBalance = manualBalances.length > 0 ? parseFloat(manualBalances[0].openingBalance || '0') : 0;

      const baseline = buildCashflowLines(expenseItems, allInflows);
      const baselineWeeks = computeWeeklyCashflow(baseline.inflowLines, baseline.outflowLines, '2025-09-01', 52, openingBalance);

      let scenarioWeeks = baselineWeeks;
      if (scenarioId) {
        const overrideMap = new Map();
        const scenarioData = buildCashflowLines(expenseItems, allInflows, overrideMap);
        scenarioWeeks = computeWeeklyCashflow(scenarioData.inflowLines, scenarioData.outflowLines, '2025-09-01', 52, openingBalance);
      }

      const weeklyData = scenarioWeeks.map((sw, i) => {
        const bw = baselineWeeks[i];
        return {
          ...sw,
          baselineClosingBalance: bw?.closingBalance ?? 0,
          baselineInflowsTotal: (bw?.inflowsActual ?? 0) + (bw?.inflowsForecast ?? 0),
          baselineOutflowsTotal: (bw?.outflowsActual ?? 0) + (bw?.outflowsForecast ?? 0),
          deltaInflows: ((sw.inflowsActual + sw.inflowsForecast) - ((bw?.inflowsActual ?? 0) + (bw?.inflowsForecast ?? 0))),
          deltaOutflows: ((sw.outflowsActual + sw.outflowsForecast) - ((bw?.outflowsActual ?? 0) + (bw?.outflowsForecast ?? 0))),
          deltaClosingBalance: sw.closingBalance - (bw?.closingBalance ?? 0),
        };
      });

      res.json({ weeks: weeklyData });
    } catch (err: any) {
      console.error('[Cashflow Forecast Scenario Weekly]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cashflow-forecast/scenario-week-detail", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const weekStart = req.query.weekStart as string;
      const weekEnd = req.query.weekEnd as string;

      if (!weekStart || !weekEnd) return res.status(400).json({ error: "weekStart and weekEnd required" });

      const [legacyExpSWD, legacyInfSWD, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const mergedSWD = await getMergedExpensesAndInflows(legacyExpSWD, legacyInfSWD);
      const allInflows = resolveInflowEffectiveDates(mergedSWD.inflows, allTaskLinks, allOpTasks, allPlanTasks);
      const expenseItems = mergedSWD.expenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const lines: any[] = [];

      for (const e of expenseItems) {
        const amount = Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
        if (amount === 0) continue;

        const entityKey = `expense_line::${e.id}`;
        const paymentDate = overrideMap[entityKey]?.['payment_date'] || e.expensePaymentDate;
        const forecastDate = overrideMap[entityKey]?.['payment_date'] || e.computedForecastPaymentDate || e.forecastPaymentDate;
        const effectiveDate = paymentDate || forecastDate;
        if (!effectiveDate) continue;

        const d = new Date(effectiveDate);
        if (isNaN(d.getTime())) continue;
        const ws = new Date(weekStart); ws.setHours(0,0,0,0);
        const we = new Date(weekEnd); we.setHours(0,0,0,0);
        d.setHours(0,0,0,0);
        if (d < ws || d > we) continue;

        lines.push({
          id: e.id,
          type: 'outflow',
          projectName: e.projectName,
          description: e.expenseLineItem || e.expenseCategory || 'Expense',
          amount,
          actualDate: e.expensePaymentDate,
          forecastDate: forecastDate,
          effectiveDate,
          invoiceNumber: e.expenseInvoiceNumber,
          poNumber: e.expensePoNumber,
          category: e.expenseCategory,
          supplierName: e.supplierName,
          confidence: scoreExpenseConfidence(e),
          hasOverride: !!overrideMap[entityKey],
          originalDate: e.expensePaymentDate || e.computedForecastPaymentDate || e.forecastPaymentDate,
        });
      }

      for (const inf of allInflows) {
        const amount = Math.abs(parseFloat(inf.milestoneAmount || '0'));
        if (amount === 0) continue;

        const entityKey = `inflow_line::${inf.id}`;
        const scenarioReceiptDate = overrideMap[entityKey]?.['receipt_date'];
        const receiptDate = scenarioReceiptDate || inf.paymentReceivedDate;
        const forecastDate = scenarioReceiptDate || inf.effectiveDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate;
        const effectiveDate = receiptDate || forecastDate;
        if (!effectiveDate) continue;

        const d = new Date(effectiveDate);
        if (isNaN(d.getTime())) continue;
        const ws = new Date(weekStart); ws.setHours(0,0,0,0);
        const we = new Date(weekEnd); we.setHours(0,0,0,0);
        d.setHours(0,0,0,0);
        if (d < ws || d > we) continue;

        lines.push({
          id: inf.id,
          type: 'inflow',
          projectName: inf.projectName,
          description: inf.milestoneName || `Milestone ${inf.milestoneNo || ''}`,
          amount,
          actualDate: inf.paymentReceivedDate,
          forecastDate: forecastDate,
          effectiveDate,
          invoiceNumber: inf.milestoneInvoiceNumber,
          poNumber: null,
          category: 'Revenue',
          supplierName: null,
          confidence: scoreInflowConfidence(inf),
          hasOverride: !!overrideMap[entityKey] || (inf.effectiveDate !== inf.paymentReceivedDate && inf.effectiveDate !== inf.computedForecastReceiptDate),
          originalDate: inf.paymentReceivedDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate,
        });
      }

      lines.sort((a, b) => b.amount - a.amount);

      const inflowTotal = lines.filter(l => l.type === 'inflow').reduce((s, l) => s + l.amount, 0);
      const outflowTotal = lines.filter(l => l.type === 'outflow').reduce((s, l) => s + l.amount, 0);

      res.json({
        lines,
        total: lines.length,
        inflowTotal,
        outflowTotal,
        inflowCount: lines.filter(l => l.type === 'inflow').length,
        outflowCount: lines.filter(l => l.type === 'outflow').length,
      });
    } catch (err: any) {
      console.error('[Cashflow Forecast Scenario Week Detail]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ SCENARIO-AWARE PLANNING API ============

  app.get("/api/planning-board/scenario-projects", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const projects = await db.select().from(projectInfo);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const projectData = projects.map((p: any) => {
        const entityKey = `project_keydate::${p.projectName}`;
        const effectiveConstructionStart = overrideMap[entityKey]?.['construction_start'] || p.constructionStartDate;
        const effectiveCommissioning = overrideMap[entityKey]?.['commissioning_date'] || p.commissioningDate;
        const effectiveOmHandover = overrideMap[entityKey]?.['om_handover_date'] || p.omHandoverDate;
        const effectiveClientHandover = overrideMap[entityKey]?.['client_handover_date'] || p.clientHandoverDate;

        return {
          projectName: p.projectName,
          pm: p.pm,
          phase: p.phase,
          sizeKwp: p.sizeKwp,
          constructionStartDate: effectiveConstructionStart,
          commissioningDate: effectiveCommissioning,
          omHandoverDate: effectiveOmHandover,
          clientHandoverDate: effectiveClientHandover,
          originalConstructionStart: p.constructionStartDate,
          originalCommissioning: p.commissioningDate,
          originalOmHandover: p.omHandoverDate,
          originalClientHandover: p.clientHandoverDate,
          hasOverride: !!overrideMap[entityKey],
          isActive: p.isActive,
        };
      });

      res.json({ projects: projectData });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/planning-board/scenario-capacity", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const resourceType = (req.query.resourceType as string) || 'PM';

      const projects = await db.select().from(projectInfo);

      let overrideMap: any = {};
      if (scenarioId) {
        overrideMap = new Map();
      }

      const weeklyDemand = new Map<string, { total: number; projects: string[] }>();
      const startDate = new Date('2025-09-01');

      for (let w = 0; w < 52; w++) {
        const weekStart = new Date(startDate);
        weekStart.setDate(startDate.getDate() + w * 7);
        const weekKey = weekStart.toISOString().split('T')[0];
        weeklyDemand.set(weekKey, { total: 0, projects: [] });
      }

      for (const p of projects) {
        if (!p.isActive) continue;

        const entityKey = `project_keydate::${p.projectName}`;
        const startStr = overrideMap[entityKey]?.['construction_start'] || p.constructionStartDate;
        const endStr = overrideMap[entityKey]?.['client_handover_date'] || p.clientHandoverDate || overrideMap[entityKey]?.['commissioning_date'] || p.commissioningDate;

        if (!startStr || !endStr) continue;

        const projStart = new Date(startStr);
        const projEnd = new Date(endStr);
        if (isNaN(projStart.getTime()) || isNaN(projEnd.getTime())) continue;

        for (const [weekKey, demand] of weeklyDemand.entries()) {
          const weekDate = new Date(weekKey);
          const weekEnd = new Date(weekDate);
          weekEnd.setDate(weekDate.getDate() + 6);

          if (projStart <= weekEnd && projEnd >= weekDate) {
            if (resourceType === 'PM') {
              const pm = p.pm || 'Unassigned';
              demand.total += 1;
              demand.projects.push(p.projectName);
            } else if (resourceType === 'Installer') {
              const sizeKwp = parseFloat(p.sizeKwp || '0');
              const durationWeeks = Math.max(1, Math.ceil((projEnd.getTime() - projStart.getTime()) / (7 * 86400000)));
              const weeklyKwp = sizeKwp / durationWeeks;
              demand.total += weeklyKwp;
              demand.projects.push(p.projectName);
            }
          }
        }
      }

      const capacityData = Array.from(weeklyDemand.entries()).map(([weekKey, d]) => ({
        weekStart: weekKey,
        demand: d.total,
        projects: d.projects,
        projectCount: d.projects.length,
        capacity: resourceType === 'PM' ? 5 : 500,
        overCapacity: resourceType === 'PM' ? d.total > 5 : d.total > 500,
      }));

      const clashes = capacityData
        .filter(c => c.overCapacity)
        .map(c => ({
          weekStart: c.weekStart,
          demand: c.demand,
          capacity: c.capacity,
          excess: c.demand - c.capacity,
          projects: c.projects,
          message: `${resourceType} over capacity week of ${c.weekStart}: ${c.projects.join(', ')}`,
        }));

      res.json({ capacity: capacityData, clashes, resourceType });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== OPERATIONAL TASKS ====================

  app.get("/api/operational-tasks/task/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: `Invalid task ID: ${req.params.id}` });
      }

      if (id < 0) {
        const planId = -id;
        let planTask: any = null;

        const [wiResult] = await db.select().from(workItems).where(eq(workItems.id, planId)).limit(1);
        if (wiResult) {
          const projName = wiResult.projectId
            ? (await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, wiResult.projectId)))[0]?.projectName || ""
            : "";
          planTask = {
            id: wiResult.id,
            projectName: projName,
            taskNo: wiResult.wbsCode,
            rowNumber: null,
            highLevelProgramme: wiResult.title,
            actualStart: wiResult.startDate,
            actualEnd: wiResult.endDate,
            durationDays: wiResult.duration,
            actualPctComplete: wiResult.percentComplete,
            expectedPctComplete: null,
            createdAt: wiResult.createdAt,
            comment: wiResult.description,
          };
        }

        if (!planTask) {
          const allProjects = await storage.getAllProjectInfo();
          for (const proj of allProjects) {
            const plans = await storage.getProjectPlansByProject(proj.projectName);
            planTask = plans.find((t: any) => t.id === planId);
            if (planTask) break;
          }
        }
        if (!planTask) return res.status(404).json({ error: "Baseline task not found" });

        const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
        let status = "todo";
        if (pctComplete >= 100) status = "complete";
        else if (pctComplete > 0) status = "in_progress";

        const syntheticTask = {
          id: -planTask.id,
          projectName: planTask.projectName,
          importedTaskId: planTask.id,
          taskNumber: planTask.taskNo || String(planTask.rowNumber || ""),
          parentTaskId: null,
          title: planTask.highLevelProgramme || `Task ${planTask.taskNo || planTask.rowNumber}`,
          description: null,
          status,
          priority: "Normal",
          startDate: planTask.actualStart || null,
          dueDate: planTask.actualEnd || null,
          durationDays: planTask.durationDays || null,
          percentComplete: pctComplete,
          expectedPercentComplete: planTask.expectedPctComplete != null ? Math.round(planTask.expectedPctComplete * 100) : null,
          assignees: null,
          tags: null,
          blockerReason: null,
          plannedHours: null,
          actualHours: null,
          sortOrder: planTask.rowNumber || 0,
          isBaseline: true,
          source: "baseline",
          createdBy: null,
          createdAt: planTask.createdAt,
          updatedAt: planTask.createdAt,
        };
        res.json({ task: syntheticTask, comments: [], checklists: [], attachments: [], activity: [] });
        return;
      }

      // Try canonical work_items
      let task: any = null;
      const { getEngineeringWorkItemById } = await import("./work-items-adapter");
      const canonicalTask = await getEngineeringWorkItemById(id);
      if (canonicalTask) {
        task = canonicalTask;
      } else {
        task = await storage.getOperationalTask(id);
      }
      if (!task) return res.status(404).json({ error: "Task not found" });
      const taskIdForSub = task.workItemId || id;
      const [comments, checklists, attachments, activity] = await Promise.all([
        storage.getTaskComments(taskIdForSub),
        storage.getTaskChecklists(taskIdForSub),
        storage.getTaskAttachments(taskIdForSub),
        storage.getTaskActivityLog(taskIdForSub),
      ]);
      const checklistsWithItems = await Promise.all(checklists.map(async cl => ({
        ...cl,
        items: await storage.getChecklistItems(cl.id),
      })));

      const { buildUserMap, mergeResolvedWithTextNames } = await import("./user-resolver");
      const userMap = await buildUserMap();
      const idResolved = (task.assigneeUserIds || []).map((uid: number) => userMap.get(uid)).filter(Boolean);
      const resolvedAssignees = mergeResolvedWithTextNames(idResolved, task.assignees, userMap);
      const resolvedOwner = task.ownerUserId ? userMap.get(task.ownerUserId) || null : null;

      res.json({ task: { ...task, resolvedAssignees, resolvedOwner }, comments, checklists: checklistsWithItems, attachments, activity });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/operational-tasks/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectName = req.params.projectName;

      // Always read from canonical work_items
      const canonicalTasks = await getWorkItemsAsOperationalTasks(projectName);
      if (canonicalTasks.length > 0) {
        return res.json(canonicalTasks);
      }

      // Legacy fallback removed — all data should be in work_items by now.
      return res.json([]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/operational-tasks", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const validationErrors = validateTaskCreate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (req.body.status) req.body.status = normalizeStatus(req.body.status);
      if (req.body.priority) req.body.priority = normalizePriority(req.body.priority);
      const task = await storage.createOperationalTask(req.body);
      await storage.createTaskActivityLog({
        taskId: task.id,
        actorId: (req.user as any)?.id || null,
        actionType: 'created',
        fieldName: null,
        oldValue: null,
        newValue: null,
      });
      logAuditFromReq(req, { entityType: "operational_task", action: "create", entityId: String(task.id), projectName: req.body.projectName, changesJson: { description: "Operational task created", title: req.body.title, projectName: req.body.projectName } });
      res.json(task);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.patch("/api/operational-tasks/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: `Invalid task ID: ${req.params.id}` });
      }
      const updates = req.body;
      const validationErrors = validateTaskUpdate(updates);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (updates.status) updates.status = normalizeStatus(updates.status);
      if (updates.priority) updates.priority = normalizePriority(updates.priority);

      if (updates.status && id > 0) {
        const oldTaskForGuard = await storage.getOperationalTask(id);
        if (!oldTaskForGuard) return sendError(res, notFound("Operational task"));
        try {
          const context = await buildTaskWorkflowContext(id, oldTaskForGuard.status);
          assertTaskWorkflowTransition(context, updates.status, "status_update");
        } catch (err: any) {
          if (err instanceof TaskWorkflowGuardError) {
            return res.status(err.statusCode).json({ error: err.message });
          }
          throw err;
        }
      }

      if (id < 0) {
        const planId = -id;
        const planTasks = await storage.getProjectPlansByProject("");
        const pt = planTasks.find((t: any) => t.id === planId) ||
          (await (async () => {
            const allPlans = await storage.getProjectPlansByProject("");
            return allPlans.find((t: any) => t.id === planId);
          })());

        let planTask: any = null;
        try {
          const allProjects = await storage.getAllProjectInfo();
          for (const proj of allProjects) {
            const plans = await storage.getProjectPlansByProject(proj.projectName);
            planTask = plans.find((t: any) => t.id === planId);
            if (planTask) break;
          }
        } catch {}

        if (!planTask) return res.status(404).json({ error: "Baseline task not found" });

        const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
        let status = "todo";
        if (pctComplete >= 100) status = "complete";
        else if (pctComplete > 0) status = "in_progress";

        const newTask = await storage.createOperationalTask({
          projectName: planTask.projectName,
          importedTaskId: planTask.id,
          taskNumber: planTask.taskNo || String(planTask.rowNumber || ""),
          title: planTask.highLevelProgramme || `Task ${planTask.taskNo || planTask.rowNumber}`,
          description: null,
          status,
          priority: "Normal",
          startDate: planTask.actualStart || null,
          dueDate: planTask.actualEnd || null,
          durationDays: planTask.durationDays || null,
          percentComplete: pctComplete,
          assignees: null,
          tags: null,
          blockerReason: null,
          plannedHours: null,
          actualHours: null,
          sortOrder: planTask.rowNumber || 0,
          source: "baseline",
          createdBy: (req.user as any)?.id || null,
          ...updates,
        });

        await storage.createTaskActivityLog({
          taskId: newTask.id,
          actorId: (req.user as any)?.id || null,
          actionType: 'promoted',
          fieldName: null,
          oldValue: `baseline:${planId}`,
          newValue: JSON.stringify(updates),
        });

        res.json({ ...newTask, isBaseline: true, _promotedFrom: planId });
        return;
      }

      const oldTask = await storage.getOperationalTask(id);
      if (!oldTask) return sendError(res, notFound("Operational task"));
      const updated = await storage.updateOperationalTask(id, updates);
      for (const [key, value] of Object.entries(updates)) {
        if ((oldTask as any)[key] !== value) {
          await storage.createTaskActivityLog({
            taskId: id,
            actorId: (req.user as any)?.id || null,
            actionType: 'updated',
            fieldName: key,
            oldValue: String((oldTask as any)[key] ?? ''),
            newValue: String(value ?? ''),
          });
        }
      }
      logAuditFromReq(req, { entityType: "operational_task", action: "update", entityId: String(id), changesJson: { description: "Operational task updated", changedFields: Object.keys(updates) } });
      res.json(updated);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.delete("/api/operational-tasks/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getOperationalTask(id);
      if (task) {
        await storage.createTaskActivityLog({
          taskId: id,
          actorId: (req.user as any)?.id || null,
          actionType: 'deleted',
          fieldName: null,
          oldValue: task.title,
          newValue: null,
        });
      }
      await storage.deleteOperationalTask(id);
      logAuditFromReq(req, { entityType: "operational_task", action: "delete", entityId: String(id), changesJson: { description: "Operational task deleted", title: task?.title } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GC-008: Task type/workstream conversion endpoint
  app.post("/api/operational-tasks/:id/convert", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { targetWorkstream } = req.body;
      const validWorkstreams = ["PM", "Engineering", "Quality", "Procurement", "Construction", "Commissioning", "Handover", "PD"];
      if (!targetWorkstream || !validWorkstreams.includes(targetWorkstream)) {
        return res.status(400).json({ error: `Invalid target workstream. Valid values: ${validWorkstreams.join(", ")}` });
      }

      const task = await storage.getOperationalTask(id);
      if (!task) return sendError(res, notFound("Operational task"));

      const oldWorkstream = (task as any).primaryWorkstream || "PM";
      const updated = await storage.updateOperationalTask(id, { primaryWorkstream: targetWorkstream });

      await storage.createTaskActivityLog({
        taskId: id,
        actorId: (req.user as any)?.id || null,
        actionType: 'converted',
        fieldName: 'primaryWorkstream',
        oldValue: oldWorkstream,
        newValue: targetWorkstream,
      });

      // Also update the linked work item's workstream if it exists
      try {
        const linkedWi = await db.select().from(workItems).where(eq(workItems.legacyTaskId, id)).limit(1);
        if (linkedWi.length > 0) {
          await db.update(workItems).set({ workstream: targetWorkstream }).where(eq(workItems.id, linkedWi[0].id));
        }
      } catch (e: any) {
        console.warn(`[task-convert] Failed to sync work item workstream for task ${id}:`, e.message);
      }

      logAuditFromReq(req, {
        entityType: "operational_task", action: "convert", entityId: String(id),
        changesJson: { from: oldWorkstream, to: targetWorkstream, title: (task as any).title },
      });

      res.json({ ...updated, _converted: { from: oldWorkstream, to: targetWorkstream } });
    } catch (err: any) {
      sendError(res, err);
    }
  });

  app.post("/api/operational-tasks/bulk-update", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { taskIds, updates } = req.body as { taskIds: number[]; updates: Record<string, any> };
      if (updates.status) updates.status = normalizeStatus(updates.status);
      if (updates.priority) updates.priority = normalizePriority(updates.priority);
      const results = [];
      for (const taskId of taskIds) {
        if (taskId < 0) {
          const planId = -taskId;
          let planTask: any = null;
          try {
            const allProjects = await storage.getAllProjectInfo();
            for (const proj of allProjects) {
              const plans = await storage.getProjectPlansByProject(proj.projectName);
              planTask = plans.find((t: any) => t.id === planId);
              if (planTask) break;
            }
          } catch {}
          if (!planTask) continue;

          const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
          let status = "Not Started";
          if (pctComplete >= 100) status = "Done";
          else if (pctComplete > 0) status = "In Progress";

          const newTask = await storage.createOperationalTask({
            projectName: planTask.projectName,
            importedTaskId: planTask.id,
            taskNumber: planTask.taskNo || String(planTask.rowNumber || ""),
            title: planTask.highLevelProgramme || `Task ${planTask.taskNo || planTask.rowNumber}`,
            description: null,
            status,
            priority: "Normal",
            startDate: planTask.actualStart || null,
            dueDate: planTask.actualEnd || null,
            durationDays: planTask.durationDays || null,
            percentComplete: pctComplete,
            assignees: null,
            tags: null,
            blockerReason: null,
            plannedHours: null,
            actualHours: null,
            sortOrder: planTask.rowNumber || 0,
            source: "baseline",
            createdBy: (req.user as any)?.id || null,
            ...updates,
          });
          results.push(newTask);
          continue;
        }
        const oldTask = await storage.getOperationalTask(taskId);
        if (!oldTask) continue;
        if (updates.status) {
          try {
            const context = await buildTaskWorkflowContext(taskId, oldTask.status);
            assertTaskWorkflowTransition(context, updates.status, "bulk_status_update");
          } catch (err: any) {
            if (err instanceof TaskWorkflowGuardError) {
              return res.status(err.statusCode).json({ error: err.message, taskId });
            }
            throw err;
          }
        }
        const updated = await storage.updateOperationalTask(taskId, updates);
        for (const [key, value] of Object.entries(updates)) {
          if ((oldTask as any)[key] !== value) {
            await storage.createTaskActivityLog({
              taskId,
              actorId: (req.user as any)?.id || null,
              actionType: 'updated',
              fieldName: key,
              oldValue: String((oldTask as any)[key] ?? ''),
              newValue: String(value ?? ''),
            });
          }
        }
        results.push(updated);
      }
      logAuditFromReq(req, { entityType: "operational_task", action: "bulk_update", changesJson: { description: `${taskIds.length} task(s) bulk updated`, taskCount: taskIds.length, changedFields: Object.keys(updates) } });
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TASK COMMENTS ====================

  app.get("/api/task-comments/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const comments = await storage.getTaskComments(parseInt(req.params.taskId));
      res.json(comments);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/task-comments", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const comment = await storage.createTaskComment(req.body);
      logAuditFromReq(req, { entityType: "task_comment", action: "create", entityId: String(comment.id), changesJson: { description: "Task comment added", taskId: req.body.taskId } });
      res.json(comment);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-comments/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTaskComment(id);
      logAuditFromReq(req, { entityType: "task_comment", action: "delete", entityId: req.params.id, changesJson: { description: "Task comment deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TASK CHECKLISTS ====================

  app.get("/api/task-checklists/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const checklists = await storage.getTaskChecklists(parseInt(req.params.taskId));
      const checklistsWithItems = await Promise.all(checklists.map(async cl => ({
        ...cl,
        items: await storage.getChecklistItems(cl.id),
      })));
      res.json(checklistsWithItems);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/task-checklists", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const checklist = await storage.createTaskChecklist(req.body);
      logAuditFromReq(req, { entityType: "task_checklist", action: "create", entityId: String(checklist.id), changesJson: { description: "Task checklist created", taskId: req.body.taskId } });
      res.json(checklist);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-checklists/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTaskChecklist(id);
      logAuditFromReq(req, { entityType: "task_checklist", action: "delete", entityId: req.params.id, changesJson: { description: "Task checklist deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/task-checklist-items", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const item = await storage.createChecklistItem(req.body);
      logAuditFromReq(req, { entityType: "checklist_item", action: "create", entityId: String(item.id), changesJson: { description: "Checklist item created" } });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/task-checklist-items/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateChecklistItem(id, req.body);
      logAuditFromReq(req, { entityType: "checklist_item", action: "update", entityId: req.params.id, changesJson: { description: "Checklist item updated" } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-checklist-items/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteChecklistItem(id);
      logAuditFromReq(req, { entityType: "checklist_item", action: "delete", entityId: req.params.id, changesJson: { description: "Checklist item deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TASK ATTACHMENTS ====================

  app.get("/api/task-attachments/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const attachments = await storage.getTaskAttachments(parseInt(req.params.taskId));
      res.json(attachments);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/task-attachments", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const attachment = await storage.createTaskAttachment(req.body);
      logAuditFromReq(req, { entityType: "task_attachment", action: "create", entityId: String(attachment.id), changesJson: { description: "Task attachment added" } });
      res.json(attachment);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-attachments/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTaskAttachment(id);
      logAuditFromReq(req, { entityType: "task_attachment", action: "delete", entityId: req.params.id, changesJson: { description: "Task attachment deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TASK ACTIVITY LOG ====================

  app.get("/api/task-activity/:taskId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const activity = await storage.getTaskActivityLog(parseInt(req.params.taskId));
      res.json(activity);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== ENRICHED PLANNING TASKS (with rollups + expected %) ====================

  app.get("/api/planning-tasks/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);

      const useCanonical = await isWorkItemsEnabled();

      let baselineTasks: any[] = [];
      let operationalTasks: any[] = [];
      let unlinkedOperationalCount = 0;

      if (useCanonical) {
        const canonicalTasks = await getAllWorkItemsForPlanTab(projectName);
        if (canonicalTasks.length > 0) {
          const allOps = await storage.getOperationalTasksByProject(projectName);
          const nonClickupOps = allOps.filter((t: any) => t.externalSource !== "clickup");
          unlinkedOperationalCount = nonClickupOps.filter((t: any) => t.importedTaskId == null).length;

          const filteredCanonical = canonicalTasks.filter((ct: any) => {
            const ws = ct.workstream || "PM";
            if (ws === "ENG" || ws === "QUALITY") return true;
            if (ct.isMilestone) return true;
            const hasWbs = ct.taskNo && String(ct.taskNo).trim().length > 0;
            const hasStart = ct.startDate && String(ct.startDate).trim().length > 0;
            const hasEnd = ct.endDate && String(ct.endDate).trim().length > 0;
            if (!hasWbs && !hasStart && !hasEnd) return false;
            return true;
          });

          const usedIds = new Set<number>();
          baselineTasks = filteredCanonical.map((ct: any, idx: number) => {
            let taskId = Number.isFinite(ct.id) && ct.id > 0 ? ct.id : (idx + 1);
            while (usedIds.has(taskId)) taskId = taskId + 100000;
            usedIds.add(taskId);

            const rawPct = ct.pctComplete != null ? Number(ct.pctComplete) : 0;
            const pctComplete = rawPct > 1 ? Math.round(rawPct) : Math.round(rawPct * 100);
            let status = "Not Started";
            if (pctComplete >= 100) status = "Done";
            else if (pctComplete > 0) status = "In Progress";

            let computedExpPct = 0;
            const tPlannedStart = (ct.startDate || "").substring(0, 10);
            const tPlannedEnd = (ct.endDate || "").substring(0, 10);
            const tActualStart = (ct.actualStartDate || "").substring(0, 10);
            const tActualEnd = (ct.actualEndDate || "").substring(0, 10);
            const tStart = tActualStart || tPlannedStart;
            const tEnd = tActualEnd || tPlannedEnd;
            if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
              const todayStr = new Date().toISOString().split("T")[0];
              if (todayStr >= tEnd) computedExpPct = 100;
              else if (todayStr <= tStart) computedExpPct = 0;
              else {
                const totalWd = saWorkingDays(tStart, tEnd);
                const elapsedWd = saWorkingDays(tStart, todayStr);
                if (totalWd && totalWd > 0 && elapsedWd !== null) {
                  computedExpPct = Math.round(Math.min(elapsedWd / totalWd, 1.0) * 100);
                }
              }
            }

            return {
              id: -taskId,
              workItemId: ct.workItemId || taskId,
              projectName,
              planProjectName: projectName,
              importedTaskId: ct.id,
              taskNumber: ct.taskNo || String(idx + 1),
              parentTaskId: null as number | null,
              parentWorkItemId: ct.parentWorkItemId || null,
              title: ct.taskName || `Task ${ct.taskNo || idx + 1}`,
              description: ct.comment || null,
              status,
              priority: "Normal",
              startDate: tPlannedStart || null,
              dueDate: tPlannedEnd || null,
              durationDays: ct.durationDays || ct.actualDurationDays || null,
              percentComplete: pctComplete,
              expectedPercentComplete: computedExpPct,
              storedActualPct: pctComplete,
              assignees: null,
              tags: null,
              blockerReason: null,
              plannedHours: null,
              actualHours: null,
              actualStartDate: tActualStart || tPlannedStart || null,
              actualEndDate: tActualEnd || tPlannedEnd || null,
              actualDurationDays: ct.actualDurationDays || ct.durationDays || null,
              comment: ct.comment || null,
              sortOrder: ct.sortOrder ?? idx,
              isBaseline: true,
              isVirtualMilestone: false,
              isMilestone: ct.isMilestone === true,
              rowNumber: null,
              parentRowNumber: null,
              indentLevel: ct.indentLevel ?? null,
              baselineStart: ct.baselineStart || null,
              baselineEnd: ct.baselineEnd || null,
              baselineDuration: ct.baselineDuration || null,
              taskMode: ct.taskMode || "auto",
              workstream: ct.workstream || "PM",
              createdBy: null,
              createdAt: null,
              updatedAt: null,
            };
          });
        }
      }

      if (baselineTasks.length === 0) {
        const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";

        const [allOperationalTasks, planTasksDirect, planTasksTracker] = await Promise.all([
          storage.getOperationalTasksByProject(projectName),
          storage.getProjectPlansByProject(projectName),
          projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
        ]);

        const nonClickupOps = allOperationalTasks.filter((t: any) => t.externalSource !== "clickup");
        operationalTasks = nonClickupOps.filter((t: any) => t.importedTaskId != null);
        unlinkedOperationalCount = nonClickupOps.length - operationalTasks.length;

        const rawPlanTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;

        const planTasks = rawPlanTasks;

        const linkedImportedIds = new Set(
          operationalTasks
            .filter((t: any) => t.importedTaskId != null)
            .map((t: any) => t.importedTaskId)
        );

        const SECTION_HEADER_TITLES = ["high level programme", "programme", "high level program"];
        baselineTasks = planTasks
          .filter((pt: any) => !linkedImportedIds.has(pt.id))
          .filter((pt: any) => {
            if (pt.isVirtual) return true;
            const title = (pt.highLevelProgramme || "").trim().toLowerCase();
            return title && !SECTION_HEADER_TITLES.includes(title);
          })
          .map((pt: any) => {
            const pctComplete = pt.actualPctComplete != null ? Math.round(pt.actualPctComplete * 100) : 0;
            let status = "Not Started";
            if (pctComplete >= 100) status = "Done";
            else if (pctComplete > 0) status = "In Progress";

            let computedExpPct: number = pt.expectedPctComplete != null ? Math.round(pt.expectedPctComplete * 100) : 0;
            if (pt.expectedPctComplete == null && !pt.isVirtual) {
              const tStart = (pt.trueActualStart || pt.actualStart || "").substring(0, 10);
              const tEnd = (pt.trueActualEnd || pt.actualEnd || "").substring(0, 10);
              if (tStart && tEnd && /^\d{4}-\d{2}-\d{2}/.test(tStart) && /^\d{4}-\d{2}-\d{2}/.test(tEnd)) {
                const todayStr = new Date().toISOString().split("T")[0];
                if (todayStr >= tEnd) {
                  computedExpPct = 100;
                } else if (todayStr <= tStart) {
                  computedExpPct = 0;
                } else {
                  const totalWd = saWorkingDays(tStart, tEnd);
                  const elapsedWd = saWorkingDays(tStart, todayStr);
                  if (totalWd && totalWd > 0 && elapsedWd !== null) {
                    computedExpPct = Math.round(Math.min(elapsedWd / totalWd, 1.0) * 100);
                  }
                }
              }
            }

            const isVirtualMilestone = pt.isVirtual === true;

            return {
              id: isVirtualMilestone ? pt.rowNumber : -pt.id,
              projectName: String(projectName),
              planProjectName: isVirtualMilestone ? projectName : pt.projectName,
              importedTaskId: isVirtualMilestone ? null : pt.id,
              taskNumber: pt.taskNo || String(pt.rowNumber || ""),
              parentTaskId: null as number | null,
              title: pt.highLevelProgramme || `Task ${pt.taskNo || pt.rowNumber}`,
              description: null,
              status: isVirtualMilestone ? "Not Started" : status,
              priority: "Normal",
              startDate: pt.actualStart || null,
              dueDate: pt.actualEnd || null,
              durationDays: pt.durationDays || null,
              percentComplete: isVirtualMilestone ? 0 : pctComplete,
              expectedPercentComplete: isVirtualMilestone ? 0 : computedExpPct,
              storedActualPct: pt.actualPctComplete != null ? Math.round(pt.actualPctComplete * 100) : null,
              assignees: null,
              tags: null,
              blockerReason: null,
              plannedHours: null,
              actualHours: null,
              actualStartDate: pt.trueActualStart || pt.actualStart || null,
              actualEndDate: pt.trueActualEnd || pt.actualEnd || null,
              actualDurationDays: pt.durationDays || null,
              comment: null as string | null,
              sortOrder: pt.sortOrder ?? pt.rowNumber ?? 0,
              isBaseline: !isVirtualMilestone,
              isVirtualMilestone,
              isMilestone: pt.isMilestone === true,
              rowNumber: pt.rowNumber,
              parentRowNumber: pt.parentRowNumber || null,
              indentLevel: pt.indentLevel ?? null,
              createdBy: null,
              createdAt: pt.createdAt || null,
              updatedAt: pt.createdAt || null,
            };
          });
      }

      const allTasks: any[] = [...baselineTasks, ...operationalTasks];

      const rowNumberToId = new Map<number, number>();
      const taskNumToId = new Map<string, number>();
      const workItemIdToTaskId = new Map<number, number>();
      let summaryTaskId: number | null = null;
      for (const t of allTasks) {
        if (t.rowNumber != null) rowNumberToId.set(t.rowNumber, t.id);
        if (t.workItemId) workItemIdToTaskId.set(t.workItemId, t.id);
        if (t.taskNumber) {
          taskNumToId.set(String(t.taskNumber), t.id);
          const num = String(t.taskNumber).toLowerCase();
          if (num === "no." || num === "no" || num === "#") {
            summaryTaskId = t.id;
          }
        }
      }

      for (const t of allTasks) {
        if (t.parentWorkItemId) {
          const parentId = workItemIdToTaskId.get(t.parentWorkItemId);
          if (parentId !== undefined) {
            t.parentTaskId = parentId;
            continue;
          }
        }
        if (t.parentRowNumber != null && t.parentRowNumber !== 0) {
          const parentId = rowNumberToId.get(t.parentRowNumber);
          if (parentId !== undefined) {
            t.parentTaskId = parentId;
            continue;
          }
        }
        if (t.parentTaskId) continue;
        const num = String(t.taskNumber || "");
        if (!num) continue;
        if (num.includes(".")) {
          const parts = num.split(".");
          parts.pop();
          const parentNum = parts.join(".");
          const parentId = taskNumToId.get(parentNum);
          if (parentId !== undefined) t.parentTaskId = parentId;
        } else if (/^\d+$/.test(num) && summaryTaskId !== null && t.id !== summaryTaskId) {
          t.parentTaskId = summaryTaskId;
        }
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();

      const taskMap = new Map<number, any>();
      const childrenMap = new Map<number, number[]>();

      for (const t of allTasks) {
        const task: any = { ...t };
        const plannedStart = t.startDate ? new Date(t.startDate) : null;
        const plannedEnd = t.dueDate ? new Date(t.dueDate) : null;

        if (plannedStart && plannedEnd && !isNaN(plannedStart.getTime()) && !isNaN(plannedEnd.getTime())) {
          task.plannedDurationDays = Math.max(1, Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 86400000) + 1);
        } else {
          task.plannedDurationDays = t.durationDays || null;
        }

        const actStart = t.actualStartDate ? new Date(t.actualStartDate) : null;
        const actEnd = t.actualEndDate ? new Date(t.actualEndDate) : null;
        if (actStart && actEnd && !isNaN(actStart.getTime()) && !isNaN(actEnd.getTime())) {
          task.computedActualDurationDays = Math.max(1, Math.round((actEnd.getTime() - actStart.getTime()) / 86400000) + 1);
        } else {
          task.computedActualDurationDays = t.actualDurationDays || null;
        }

        taskMap.set(t.id, task);
        if (t.parentTaskId) {
          if (!childrenMap.has(t.parentTaskId)) childrenMap.set(t.parentTaskId, []);
          childrenMap.get(t.parentTaskId)!.push(t.id);
        }
      }

      for (const [parentId] of childrenMap) {
        const parentTask = taskMap.get(parentId);
        if (parentTask && !parentTask.isMilestone) {
          parentTask.isMilestone = true;
        }
      }

      const calcExpected = (t: any): number | null => {
        if (t.expectedPercentComplete != null) return t.expectedPercentComplete;
        const useActual = t.actualStartDate && t.actualEndDate;
        const startStr = useActual ? t.actualStartDate : t.startDate;
        const endStr = useActual ? t.actualEndDate : t.dueDate;
        const plannedStart = startStr ? new Date(startStr) : null;
        const plannedEnd = endStr ? new Date(endStr) : null;
        if (!plannedStart || !plannedEnd || isNaN(plannedStart.getTime()) || isNaN(plannedEnd.getTime())) return null;
        const startMs = plannedStart.getTime();
        const endMs = plannedEnd.getTime();
        if (todayMs < startMs) return 0;
        if (todayMs >= endMs) return 100;
        const totalDays = Math.max(1, (endMs - startMs) / 86400000);
        const elapsed = (todayMs - startMs) / 86400000;
        return Math.round((elapsed / totalDays) * 100);
      };

      const getStoredExpected = (t: any): number | null => {
        if (t.expectedPercentComplete != null) return t.expectedPercentComplete;
        return null;
      };

      const computeRollups = (taskId: number): void => {
        const children = childrenMap.get(taskId);
        if (!children || children.length === 0) {
          const t = taskMap.get(taskId);
          if (t) t.computedExpectedPct = calcExpected(t);
          return;
        }
        for (const childId of children) computeRollups(childId);

        const parent = taskMap.get(taskId);
        if (!parent) return;

        let minPlannedStart: Date | null = null;
        let maxPlannedEnd: Date | null = null;
        let minActualStart: Date | null = null;
        let maxActualEnd: Date | null = null;
        let totalWeightedPct = 0;
        let totalWeightedExpected = 0;
        let totalWeight = 0;

        for (const childId of children) {
          const child = taskMap.get(childId);
          if (!child) continue;
          const ps = child.startDate ? new Date(child.startDate) : null;
          const pe = child.dueDate ? new Date(child.dueDate) : null;
          const as2 = child.actualStartDate ? new Date(child.actualStartDate) : null;
          const ae = child.actualEndDate ? new Date(child.actualEndDate) : null;

          if (ps && !isNaN(ps.getTime()) && (!minPlannedStart || ps < minPlannedStart)) minPlannedStart = ps;
          if (pe && !isNaN(pe.getTime()) && (!maxPlannedEnd || pe > maxPlannedEnd)) maxPlannedEnd = pe;
          if (as2 && !isNaN(as2.getTime()) && (!minActualStart || as2 < minActualStart)) minActualStart = as2;
          if (ae && !isNaN(ae.getTime()) && (!maxActualEnd || ae > maxActualEnd)) maxActualEnd = ae;

          const weight = child.plannedDurationDays || 1;
          totalWeightedPct += (child.percentComplete || 0) * weight;
          totalWeightedExpected += (child.computedExpectedPct ?? 0) * weight;
          totalWeight += weight;
        }

        if (!parent.isBaseline || !parent.startDate) {
          if (minPlannedStart) parent.startDate = minPlannedStart.toISOString().split('T')[0];
        }
        if (!parent.isBaseline || !parent.dueDate) {
          if (maxPlannedEnd) parent.dueDate = maxPlannedEnd.toISOString().split('T')[0];
        }
        if (parent.startDate && parent.dueDate) {
          const ps = new Date(parent.startDate);
          const pe = new Date(parent.dueDate);
          if (!isNaN(ps.getTime()) && !isNaN(pe.getTime())) {
            parent.plannedDurationDays = Math.max(1, Math.round((pe.getTime() - ps.getTime()) / 86400000) + 1);
          }
        }
        if (minActualStart) parent.actualStartDate = minActualStart.toISOString().split('T')[0];
        if (maxActualEnd) parent.actualEndDate = maxActualEnd.toISOString().split('T')[0];
        if (minActualStart && maxActualEnd) {
          parent.computedActualDurationDays = Math.max(1, Math.round((maxActualEnd.getTime() - minActualStart.getTime()) / 86400000) + 1);
        }

        const computedActual = totalWeight > 0 ? Math.round(totalWeightedPct / totalWeight) : (parent.percentComplete || 0);
        if (parent.isBaseline && parent.storedActualPct != null) {
          parent.percentComplete = parent.storedActualPct;
        } else {
          parent.percentComplete = computedActual;
        }
        parent.computedExpectedPct = totalWeight > 0 ? Math.round(totalWeightedExpected / totalWeight) : calcExpected(parent);
        parent.isParent = true;
        parent.childCount = children.length;
      };

      for (const [, t] of taskMap) {
        if (childrenMap.has(t.id)) continue;
        const pct = t.percentComplete || 0;
        if (pct < 100 && t.actualEndDate) {
          const actualEnd = new Date(t.actualEndDate);
          if (!isNaN(actualEnd.getTime()) && actualEnd.getTime() <= todayMs) {
            t.percentComplete = 100;
            t.storedActualPct = 100;
            if (t.status === "Not Started" || t.status === "active") t.status = "Done";
          }
        }
      }

      const rootIds = allTasks.filter(t => !t.parentTaskId).map(t => t.id);
      for (const rootId of rootIds) computeRollups(rootId);

      for (const [, t] of taskMap) {
        if (!childrenMap.has(t.id)) {
          t.computedExpectedPct = calcExpected(t);
        }
        if (t.percentComplete < 100 && t.actualEndDate) {
          const actualEnd = new Date(t.actualEndDate);
          if (!isNaN(actualEnd.getTime()) && actualEnd.getTime() <= todayMs) {
            t.percentComplete = 100;
            t.storedActualPct = 100;
            if (t.status === "Not Started" || t.status === "active" || t.status === "In Progress") t.status = "Done";
          }
        }
        if (t.isVirtualMilestone && (t.isParent || t.childCount > 0)) {
          const pct = t.percentComplete || 0;
          if (pct >= 100) t.status = "Done";
          else if (pct > 0) t.status = "In Progress";
          else t.status = "Not Started";
        }
        const pct = t.percentComplete || 0;
        const exp = t.computedExpectedPct ?? 0;
        const delta = pct - exp;
        t.delta = delta;
        if (delta < -5) t.planStatus = 'behind';
        else if (delta > 5) t.planStatus = 'ahead';
        else t.planStatus = 'on_track';
      }

      const sortByTaskCode = (a: any, b: any): number => {
        const aCode = a.taskNumber || '';
        const bCode = b.taskNumber || '';
        const aParts = aCode.split('.').map((p: string) => parseInt(p) || 0);
        const bParts = bCode.split('.').map((p: string) => parseInt(p) || 0);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const av = aParts[i] || 0;
          const bv = bParts[i] || 0;
          if (av !== bv) return av - bv;
        }
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      };

      const result = Array.from(taskMap.values()).sort(sortByTaskCode);

      const userId = (req as any).user?.id;
      if (userId) {
        try {
          const assignmentRows = await db.execute(sql`
            SELECT work_item_id, role FROM work_item_assignments
            WHERE user_id = ${userId}
          `);
          const roleMap = new Map<number, string>();
          const rows = Array.isArray(assignmentRows) ? assignmentRows : (assignmentRows as any).rows || [];
          for (const r of rows) roleMap.set(r.work_item_id, r.role);
          for (const t of result) {
            const wiId = t.importedTaskId || Math.abs(t.id);
            const role = roleMap.get(wiId);
            t.assignmentRole = role || null;
          }
        } catch {}
      }

      res.json({ tasks: result, unlinkedOperationalCount });
    } catch (err: any) {
      console.error("Planning tasks error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/planning-tasks/:projectName/summary-rollup", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const allTasks = await db.select().from(workItems).where(
        and(
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
          sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
        )
      );

      const childrenByParent = new Map<number, typeof allTasks>();
      for (const t of allTasks) {
        if (t.parentId) {
          if (!childrenByParent.has(t.parentId)) childrenByParent.set(t.parentId, []);
          childrenByParent.get(t.parentId)!.push(t);
        }
      }

      const rollup: Record<number, { percentComplete: number; startDate: string | null; endDate: string | null; duration: number | null }> = {};

      for (const [parentId, children] of childrenByParent) {
        let minStart: string | null = null;
        let maxEnd: string | null = null;
        let totalDuration = 0;
        let weightedPct = 0;
        let totalWeight = 0;

        for (const c of children) {
          const s = c.startDate;
          const e = c.endDate;
          if (s && (!minStart || s < minStart)) minStart = s;
          if (e && (!maxEnd || e > maxEnd)) maxEnd = e;
          const dur = c.duration || 1;
          totalDuration += dur;
          const pct = c.percentComplete != null ? Number(c.percentComplete) : 0;
          weightedPct += pct * dur;
          totalWeight += dur;
        }

        rollup[parentId] = {
          percentComplete: totalWeight > 0 ? Math.round((weightedPct / totalWeight) * 100) / 100 : 0,
          startDate: minStart,
          endDate: maxEnd,
          duration: totalDuration || null,
        };
      }

      res.json(rollup);
    } catch (err: any) {
      console.error("Summary rollup error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== PLAN TASK EDITING (with COO notifications) ====================

  const canEditProjectTasks = async (req: Request, projectName: string): Promise<boolean> => {
    const user = req.user as any;
    if (!user) return false;
    const role = user.role || "";
    if (["admin", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"].includes(role)) return true;
    const info = await storage.getProjectInfo(projectName);
    if (!info) return false;
    if (info.pm === user.name || info.pd === user.name) return true;
    if (info.pmUserId === user.id || info.pdUserId === user.id) return true;
    return false;
  };

  app.patch("/api/planning-tasks/:taskId", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.taskId);
      if (!Number.isFinite(taskId)) {
        return res.status(400).json({ error: `Invalid task ID: ${req.params.taskId}` });
      }
      const user = req.user as any;
      const { projectName, ...updates } = req.body;
      if (!projectName) return res.status(400).json({ error: "projectName is required" });

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return res.status(403).json({ error: "You don't have permission to edit this project's tasks" });

      if (updates.status) updates.status = normalizeStatus(updates.status);
      if (updates.priority) updates.priority = normalizePriority(updates.priority);

      const actualTaskId = Math.abs(taskId);

      const planTaskResult = await db.select().from(workItems).where(
        and(
          eq(workItems.legacyTable, "project_plan"),
          eq(workItems.legacyId, actualTaskId),
          isNull(workItems.deletedAt)
        )
      ).limit(1);
      const isProjectPlanTask = planTaskResult.length > 0;

      let workItemResult = !isProjectPlanTask
        ? await db.select().from(workItems).where(
            and(
              eq(workItems.legacyTable, "normalized_plan_tasks"),
              eq(workItems.legacyId, actualTaskId),
              isNull(workItems.deletedAt)
            )
          ).limit(1)
        : [];

      if (!isProjectPlanTask && workItemResult.length === 0) {
        workItemResult = await db.select().from(workItems).where(
          and(
            eq(workItems.id, actualTaskId),
            isNull(workItems.deletedAt)
          )
        ).limit(1);
      }

      if (!isProjectPlanTask && workItemResult.length === 0) {
        workItemResult = await db.select().from(workItems).where(
          and(
            eq(workItems.legacyId, actualTaskId),
            isNull(workItems.deletedAt),
            sql`${workItems.projectId} IN (SELECT id FROM project_info WHERE project_name = ${projectName})`
          )
        ).limit(1);
      }
      const isWorkItemTask = workItemResult.length > 0;

      if (isProjectPlanTask) {
        const scenario = await storage.getOrCreateActiveScenario(projectName);
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find((o: any) => o.importedTaskId === actualTaskId);

        const basePlanTask = planTaskResult[0];
        const taskName = updates.title || basePlanTask?.title || "Unknown task";

        const overrideData: any = {};
        const notifFields: { field: string; old: string | null; new_: string | null }[] = [];

        if (updates.title != null) {
          overrideData.overrideName = updates.title;
          notifFields.push({ field: "title", old: basePlanTask?.highLevelProgramme || null, new_: updates.title });
        }
        if (updates.startDate != null) {
          overrideData.overrideStartDate = updates.startDate;
          notifFields.push({ field: "startDate", old: basePlanTask?.actualStart || null, new_: updates.startDate });
        }
        if (updates.dueDate != null || updates.endDate != null) {
          const endVal = updates.dueDate || updates.endDate;
          overrideData.overrideEndDate = endVal;
          notifFields.push({ field: "endDate", old: basePlanTask?.actualEnd || null, new_: endVal });
        }
        if (updates.status != null) {
          notifFields.push({ field: "status", old: null, new_: updates.status });
        }
        if (updates.percentComplete != null) {
          notifFields.push({ field: "percentComplete", old: basePlanTask?.actualPctComplete != null ? String(Math.round(basePlanTask.actualPctComplete * 100)) : null, new_: String(updates.percentComplete) });
        }
        if (updates.comment != null) {
          overrideData.overrideComment = updates.comment;
        }

        if (existing) {
          await storage.updateTaskOverride(existing.id, overrideData);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: actualTaskId,
            overrideStartDate: overrideData.overrideStartDate || null,
            overrideEndDate: overrideData.overrideEndDate || null,
            overrideName: overrideData.overrideName || null,
            overrideTaskNo: null,
            overrideComment: overrideData.overrideComment || null,
            deletedFlag: 0,
            isNewTask: 0,
          });
        }

        if (updates.workstream != null) {
          const validWorkstreams = ["PM", "ENG", "QUALITY"];
          if (validWorkstreams.includes(updates.workstream)) {
            try {
              await db.update(workItems).set({ workstream: updates.workstream }).where(
                and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, actualTaskId))
              );
            } catch (e) {
              console.warn(`[planning-tasks] Failed to update workstream for legacy task ${actualTaskId}:`, e);
            }
          }
        }

        if (updates.status != null || updates.percentComplete != null) {
          const pctVal = updates.percentComplete != null ? updates.percentComplete / 100 : undefined;
          const statusVal = updates.status;
          const updateFields: any = {};
          if (pctVal !== undefined) updateFields.actualPctComplete = pctVal;
          if (statusVal === "Done" && pctVal === undefined) updateFields.actualPctComplete = 1.0;

          if (Object.keys(updateFields).length > 0) {
            try {
              const wiPct = updateFields.actualPctComplete;
              if (wiPct !== undefined) {
                const result = await db.update(workItems).set({ percentComplete: wiPct }).where(
                  and(eq(workItems.legacyTable, "project_plan"), eq(workItems.legacyId, actualTaskId))
                ).returning({ id: workItems.id });
                if (result.length === 0) {
                  const wiByProject = await db.execute(sql`
                    SELECT wi.id, wi.title, pi.project_name
                    FROM work_items wi
                    JOIN project_info pi ON wi.project_id = pi.id
                    WHERE wi.legacy_table = 'project_plan' AND wi.legacy_id = ${actualTaskId} AND wi.deleted_at IS NULL
                    LIMIT 1
                  `);
                  if (wiByProject.rows.length > 0) {
                    await db.update(workItems).set({ percentComplete: wiPct }).where(
                      eq(workItems.id, (wiByProject.rows[0] as any).id)
                    );
                  }
                }
              }
            } catch (e) {
              console.warn(`[planning-tasks] Failed to sync percentComplete to work_items for task ${actualTaskId}:`, e);
            }
          }
        }

        // Notifications feature removed - planEditNotifications inserts are now no-ops

        logAuditFromReq(req, {
          entityType: "plan_task",
          action: "update",
          entityId: String(actualTaskId),
          projectName,
          changesJson: { taskName, ...updates },
        });

        res.json({ success: true, taskId });
      } else if (isWorkItemTask) {
        const wi = workItemResult[0];
        const taskName = updates.title || wi.title || "Unknown task";
        const wiUpdateFields: any = {};
        const notifFields: { field: string; old: string | null; new_: string | null }[] = [];

        if (updates.title != null) {
          wiUpdateFields.title = updates.title;
          notifFields.push({ field: "title", old: wi.title || null, new_: updates.title });
        }
        if (updates.startDate != null) {
          wiUpdateFields.startDate = updates.startDate;
          notifFields.push({ field: "startDate", old: wi.startDate || null, new_: updates.startDate });
        }
        if (updates.dueDate != null || updates.endDate != null) {
          const endVal = updates.dueDate || updates.endDate;
          wiUpdateFields.endDate = endVal;
          notifFields.push({ field: "endDate", old: wi.endDate || null, new_: endVal });
        }
        if (updates.status != null) {
          wiUpdateFields.status = updates.status;
          notifFields.push({ field: "status", old: wi.status || null, new_: updates.status });
        }
        if (updates.percentComplete != null) {
          wiUpdateFields.percentComplete = updates.percentComplete / 100;
          notifFields.push({
            field: "percentComplete",
            old: wi.percentComplete != null ? String(Math.round(Number(wi.percentComplete) * 100)) : null,
            new_: String(updates.percentComplete),
          });
        }
        if (updates.comment != null || updates.description != null) {
          wiUpdateFields.description = updates.comment || updates.description;
        }
        if (updates.priority != null) {
          wiUpdateFields.priority = updates.priority;
        }
        if (updates.duration != null) {
          wiUpdateFields.duration = updates.duration;
          notifFields.push({ field: "duration", old: wi.duration != null ? String(wi.duration) : null, new_: String(updates.duration) });
          if (updates.startDate || wi.startDate) {
            const start = new Date(updates.startDate || wi.startDate!);
            start.setDate(start.getDate() + updates.duration);
            wiUpdateFields.endDate = start.toISOString().split("T")[0];
          }
        }
        if (updates.assigneeUserId != null) {
          wiUpdateFields.ownerUserId = updates.assigneeUserId || null;
          notifFields.push({ field: "assignee", old: wi.ownerUserId ? String(wi.ownerUserId) : null, new_: String(updates.assigneeUserId) });
        }
        if (updates.wbsCode != null) {
          wiUpdateFields.wbsCode = updates.wbsCode;
        }
        if (updates.workstream != null) {
          const validWorkstreams = ["PM", "ENG", "QUALITY"];
          if (validWorkstreams.includes(updates.workstream)) {
            wiUpdateFields.workstream = updates.workstream;
            notifFields.push({ field: "workstream", old: wi.workstream || "PM", new_: updates.workstream });
          }
        }
        if (updates.baselineStart != null) {
          wiUpdateFields.baselineStart = updates.baselineStart;
        }
        if (updates.baselineEnd != null) {
          wiUpdateFields.baselineEnd = updates.baselineEnd;
        }
        if (updates.baselineDuration != null) {
          wiUpdateFields.baselineDuration = updates.baselineDuration;
        }
        if (updates.taskMode != null) {
          wiUpdateFields.taskMode = updates.taskMode;
        }

        if ((updates.status === "complete" || updates.status === "Done") && updates.percentComplete == null) {
          wiUpdateFields.percentComplete = 1.0;
        }

        if (Object.keys(wiUpdateFields).length > 0) {
          await db.update(workItems).set(wiUpdateFields).where(eq(workItems.id, wi.id));
        }

        try {
          const wiSyncFields: any = {};
          if (updates.title != null) wiSyncFields.title = updates.title;
          if (updates.startDate != null) wiSyncFields.startDate = updates.startDate;
          if (updates.dueDate != null || updates.endDate != null) wiSyncFields.endDate = updates.dueDate || updates.endDate;
          if (updates.percentComplete != null) wiSyncFields.percentComplete = updates.percentComplete / 100;
          if ((updates.status === "complete" || updates.status === "Done") && updates.percentComplete == null) wiSyncFields.percentComplete = 1.0;
          if (Object.keys(wiSyncFields).length > 0) {
            await db.update(workItems).set(wiSyncFields).where(
              and(eq(workItems.legacyTable, "normalized_plan_tasks"), eq(workItems.legacyId, actualTaskId), isNull(workItems.deletedAt))
            );
          }
        } catch (e) {
          console.warn(`[planning-tasks] Failed to sync to work_items for task ${actualTaskId}:`, e);
        }

        // Notifications feature removed - planEditNotifications inserts are now no-ops

        logAuditFromReq(req, {
          entityType: "plan_task",
          action: "update",
          entityId: String(wi.id),
          projectName,
          changesJson: { taskName, ...updates },
        });

        res.json({ success: true, taskId, workItemId: wi.id });
      } else {
        // Canonical boundary: work_items is write-master for active planning task edits.
        const wiUpdateFields: any = {};
        if (updates.title != null) wiUpdateFields.title = updates.title;
        if (updates.status != null) wiUpdateFields.status = updates.status;
        if (updates.priority != null) wiUpdateFields.priority = updates.priority;
        if (updates.startDate != null) wiUpdateFields.startDate = updates.startDate;
        if (updates.dueDate != null) wiUpdateFields.endDate = updates.dueDate;
        if (updates.percentComplete != null) wiUpdateFields.percentComplete = updates.percentComplete / 100;
        if (updates.comment != null) wiUpdateFields.description = updates.comment;

        if (Object.keys(wiUpdateFields).length > 0 && isWorkItemTask) {
          await db.update(workItems).set(wiUpdateFields).where(eq(workItems.id, wi.id));

          // Legacy mirror removed — work_items is now the canonical source.
        }

        res.json({ success: true, taskId, workItemId: wi?.id ?? null });
      }
    } catch (err: any) {
      console.error("Plan task update error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/planning-tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { projectName, title, startDate, dueDate, status, priority, isMilestone, parentTaskId } = req.body;
      if (!projectName) return sendError(res, badRequest("projectName is required"));
      const validationErrors = validateTaskCreate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return res.status(403).json({ error: "FORBIDDEN", message: "You don't have permission to create tasks" });

      const normalizedStatus = normalizeStatus(status || "Not Started");
      const normalizedPriority = normalizePriority(priority || "Normal");

      const projectInfoRow = await storage.getProjectInfo(projectName);
      const projectId = projectInfoRow?.id || null;

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

      let workItem: any;
      let task: any;

      await db.transaction(async (tx) => {
        [workItem] = await tx.insert(workItems).values({
          projectId,
          workstream: "PM",
          source: "UI",
          title,
          status: normalizedStatus,
          priority: normalizedPriority,
          startDate: startDate || null,
          endDate: dueDate || null,
          percentComplete: 0,
          wbsCode: newWbsCode,
          indentLevel: 0,
          parentId: null,
          isMilestone: isMilestone || false,
          createdBy: user.id,
          taskMode: "auto",
        }).returning();
      });

      // Legacy mirror removed — work_items is the canonical source.
      task = { id: workItem.id };

      // Notifications feature removed - planEditNotifications insert for task_created is now a no-op

      logAuditFromReq(req, {
        entityType: "plan_task",
        action: "create",
        entityId: String(workItem.id),
        projectName,
        changesJson: { title, status, priority, wbsCode: newWbsCode },
      });

      res.json({ ...task, workItemId: workItem.id, wbsCode: newWbsCode });
    } catch (err: any) {
      console.error("Plan task create error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/planning-tasks/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const { projectName, operation, taskIds } = req.body;
      if (!projectName || !operation || !Array.isArray(taskIds) || taskIds.length === 0) {
        return sendError(res, badRequest("projectName, operation, and taskIds[] required"));
      }

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return sendError(res, forbidden("You don't have permission to update tasks"));

      const results: Array<{ id: number; success: boolean; error?: string }> = [];

      if (operation === "delete") {
        for (const id of taskIds) {
          try {
            await db.update(workItems).set({ deletedAt: new Date() }).where(eq(workItems.id, id));
            results.push({ id, success: true });
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else if (operation === "indent") {
        for (const id of taskIds) {
          try {
            const [task] = await db.select().from(workItems).where(eq(workItems.id, id));
            if (task) {
              const siblings = await db.select().from(workItems).where(
                and(
                  eq(workItems.workstream, "PM"),
                  isNull(workItems.deletedAt),
                  eq(workItems.parentId, task.parentId || 0),
                  sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
                )
              );
              const sorted = siblings.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
              const idx = sorted.findIndex((s: any) => s.id === id);
              if (idx > 0) {
                await db.update(workItems).set({ parentId: sorted[idx - 1].id, indentLevel: (task.indentLevel || 0) + 1 }).where(eq(workItems.id, id));
                results.push({ id, success: true });
              } else {
                results.push({ id, success: false, error: "No task above to indent under" });
              }
            }
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else if (operation === "outdent") {
        for (const id of taskIds) {
          try {
            const [task] = await db.select().from(workItems).where(eq(workItems.id, id));
            if (task && task.parentId) {
              const [parent] = await db.select().from(workItems).where(eq(workItems.id, task.parentId));
              await db.update(workItems).set({
                parentId: parent?.parentId || null,
                indentLevel: Math.max(0, (task.indentLevel || 1) - 1),
              }).where(eq(workItems.id, id));
              results.push({ id, success: true });
            } else {
              results.push({ id, success: false, error: "Already at top level" });
            }
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else if (operation === "moveUp" || operation === "moveDown") {
        for (const id of taskIds) {
          try {
            const [task] = await db.select().from(workItems).where(eq(workItems.id, id));
            if (task) {
              const siblings = await db.select().from(workItems).where(
                and(
                  eq(workItems.workstream, "PM"),
                  isNull(workItems.deletedAt),
                  task.parentId ? eq(workItems.parentId, task.parentId) : isNull(workItems.parentId),
                  sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
                )
              );
              const sorted = siblings.sort((a: any, b: any) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
              const idx = sorted.findIndex((s: any) => s.id === id);
              const swapIdx = operation === "moveUp" ? idx - 1 : idx + 1;
              if (swapIdx >= 0 && swapIdx < sorted.length) {
                const curOrder = sorted[idx].sortOrder ?? idx * 10;
                const swapOrder = sorted[swapIdx].sortOrder ?? swapIdx * 10;
                await db.update(workItems).set({ sortOrder: swapOrder }).where(eq(workItems.id, sorted[idx].id));
                await db.update(workItems).set({ sortOrder: curOrder }).where(eq(workItems.id, sorted[swapIdx].id));
                results.push({ id, success: true });
              } else {
                results.push({ id, success: false, error: `Cannot move ${operation === "moveUp" ? "up" : "down"}` });
              }
            }
          } catch (e: any) {
            results.push({ id, success: false, error: e.message });
          }
        }
      } else {
        return res.status(400).json({ error: `Unknown operation: ${operation}` });
      }

      const succeeded = results.filter(r => r.success).length;

      logAuditFromReq(req, {
        entityType: "plan_task",
        action: `bulk_${operation}`,
        entityId: taskIds.join(","),
        projectName,
        changesJson: { operation, taskIds, succeeded },
      });

      res.json({ success: true, results });
    } catch (err: any) {
      console.error("Bulk plan task error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/planning-tasks/:taskId", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const user = req.user as any;
      const { projectName } = req.body;
      if (!projectName) return sendError(res, badRequest("projectName is required"));

      const canEdit = await canEditProjectTasks(req, projectName);
      if (!canEdit) return sendError(res, forbidden("You don't have permission to delete tasks"));

      const isBaselineTask = taskId < 0;
      const actualTaskId = Math.abs(taskId);

      if (isBaselineTask) {
        const scenario = await storage.getOrCreateActiveScenario(projectName);
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find((o: any) => o.importedTaskId === actualTaskId);

        if (existing) {
          await storage.softDeleteTaskOverride(existing.id);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: actualTaskId,
            overrideStartDate: null,
            overrideEndDate: null,
            overrideName: null,
            overrideTaskNo: null,
            overrideComment: null,
            deletedFlag: 1,
            isNewTask: 0,
          });
        }
      } else {
        // Canonical boundary: soft-delete work_items only (operational_tasks no longer used).
        await softDeleteCanonicalWorkItemByLegacyTaskId(taskId);
      }

      // Notifications feature removed - planEditNotifications insert for task_deleted is now a no-op

      logAuditFromReq(req, {
        entityType: "plan_task",
        action: "delete",
        entityId: String(taskId),
        projectName,
        changesJson: { deleted: true },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Plan task delete error:", err);
      sendError(res, err);
    }
  });

  // ==================== PLAN EDIT NOTIFICATIONS (REMOVED) ====================
  // Notifications feature removed - plan-edit-notification endpoints removed

  // ==================== KEY DATE MAPPINGS ====================

  app.get("/api/key-date-mappings/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getKeyDateMappings(decodeURIComponent(req.params.projectName));
      res.json(mappings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/key-date-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mapping = await storage.createKeyDateMapping({ ...req.body, createdBy: (req.user as any)?.id });
      logAuditFromReq(req, { entityType: "key_date_mapping", entityId: String(mapping.id), action: "create", changesJson: req.body });
      res.json(mapping);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateKeyDateMapping(id, req.body);
      logAuditFromReq(req, { entityType: "key_date_mapping", entityId: req.params.id, action: "update", changesJson: req.body });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteKeyDateMapping(id);
      logAuditFromReq(req, { entityType: "key_date_mapping", entityId: req.params.id, action: "delete" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  async function resolveKeyDates(projectId: number | null, projectName: string): Promise<any[]> {
    let planTasks: any[] = [];

    if (projectId) {
      const rows = await db.select().from(workItems)
        .where(and(
          eq(workItems.projectId, projectId),
          sql`${workItems.workstream} IN ('PM')`,
          eq(workItems.source, "SMART_IMPORT"),
          isNull(workItems.deletedAt),
        ));
      planTasks = rows.map((wi: any) => ({
        id: wi.id,
        highLevelProgramme: wi.title,
        actualStart: wi.startDate || null,
        actualEnd: wi.endDate || null,
        trueActualStart: wi.actualStart || wi.startDate || null,
        trueActualEnd: wi.actualEnd || wi.endDate || null,
        taskNo: wi.wbsCode || null,
        baselineStart: null,
        baselineEnd: null,
      }));
    }

    if (planTasks.length === 0 && projectName) {
      const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";
      const [planTasksDirect, planTasksTracker] = await Promise.all([
        storage.getProjectPlansByProject(projectName),
        projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
      ]);
      planTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;
    }

    const autoMappings = [
      { keyDateName: "PD Handover", patterns: ['bd handover', 'project charter handover'], dateField: 'actualEnd' as const, sortOrder: 1 },
      { keyDateName: "Construction Start", patterns: ['site establishment'], dateField: 'actualStart' as const, sortOrder: 2 },
      { keyDateName: "Commissioning", patterns: ['commissioning'], dateField: 'actualEnd' as const, sortOrder: 3 },
      { keyDateName: "Practical Completion", patterns: ['practical completion'], dateField: 'actualEnd' as const, sortOrder: 4 },
      { keyDateName: "O&M Handover", patterns: ['handover to matriarch'], dateField: 'actualEnd' as const, sortOrder: 5 },
      { keyDateName: "Client Handover", patterns: ['handover to client'], dateField: 'actualEnd' as const, sortOrder: 6 },
    ];

    return autoMappings.map(mapping => {
      let matchedTask: any = null;
      let effectiveDate: string | null = null;

      for (const task of planTasks) {
        const desc = (task.highLevelProgramme || '').toLowerCase();
        const matches = mapping.patterns.some(p => desc.includes(p));
        if (matches) {
          const trueActual = mapping.dateField === 'actualStart' ? task.trueActualStart : task.trueActualEnd;
          const fallback = mapping.dateField === 'actualStart' ? task.actualStart : task.actualEnd;
          const dateVal = trueActual || fallback;
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

      const plannedStart = matchedTask?.actualStart?.substring(0, 10) || matchedTask?.baselineStart?.substring(0, 10) || null;
      const plannedEnd = matchedTask?.actualEnd?.substring(0, 10) || matchedTask?.baselineEnd?.substring(0, 10) || null;
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
  }

  app.get("/api/key-dates/by-id/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const [piRow] = await db.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId)).limit(1);
      const pName = piRow?.projectName || "";
      res.json(await resolveKeyDates(projectId, pName));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/key-dates/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const [piRow] = await db.select({ id: projectInfo.id }).from(projectInfo).where(eq(projectInfo.projectName, projectName)).limit(1);
      const projectId = piRow?.id || null;
      res.json(await resolveKeyDates(projectId, projectName));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

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

  // ==================== MY TOOL - SETTINGS ====================

  app.get("/api/mytool/settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const settings = await storage.getMytoolSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateMytoolSettings(req.body);
      logAuditFromReq(req, { entityType: "mytool_settings", action: "update", changesJson: { description: "MyTool settings updated" } });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== CALENDAR - COMBINED TASKS ====================

  app.get("/api/calendar/my-tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const userName = (req.user as any).username;
      const displayName = (req.user as any).name || userName;

      const [myToolTasksResult, opTasksForUser, planTasksForUser, engTasksForUser, qcItemsForUser] = await Promise.all([
        safeLegacyQuery(() => db.select().from(mytoolTasks).where(eq(mytoolTasks.ownerUserId, userId)), []),
        safeLegacyQuery(() => db.select().from(workItems).where(
          and(
            isNull(workItems.deletedAt),
            or(
              eq(workItems.ownerUserId, userId),
              sql`EXISTS (SELECT 1 FROM work_item_assignments wia WHERE wia.work_item_id = ${workItems.id} AND wia.user_id = ${userId})`
            )
          )
        ), []),
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
        safeLegacyQuery(() => db.execute(sql`
          SELECT qi.*, qc.project_name, qc.project_id, qti.item_name
          FROM qc_item_instance qi
          JOIN qc_checklist qc ON qi.checklist_id = qc.id
          JOIN qc_template_item qti ON qi.template_item_id = qti.id
          WHERE qi.assignee_user_id = ${userId}
            AND qi.is_applicable = true
        `), { rows: [] } as any),
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

  app.get("/api/mytool/tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;

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

  app.post("/api/mytool/tasks", requireAuth, requireAdmin, async (req, res) => {
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
      if (req.body.status) req.body.status = normalizeStatus(req.body.status);
      if (req.body.priority) req.body.priority = normalizePriority(req.body.priority);

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
        });
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

  app.patch("/api/mytool/tasks/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const userId = (req.user as any).id;
      const validationErrors = validateTaskUpdate(req.body);
      if (validationErrors.length > 0) {
        const fields: Record<string, string> = {};
        validationErrors.forEach(e => { fields[e.field] = e.message; });
        return sendError(res, validationError(fields));
      }
      if (req.body.status) req.body.status = normalizeStatus(req.body.status);
      if (req.body.priority) req.body.priority = normalizePriority(req.body.priority);
      const existingTask = await storage.getMytoolTask(taskId);

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

  app.delete("/api/mytool/tasks/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteMytoolTask(parseInt(req.params.id));
      logAuditFromReq(req, { entityType: "mytool_task", action: "delete", entityId: req.params.id, changesJson: { description: "MyTool task deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/mytool/tasks/:id/dependencies", requireAuth, requireAdmin, async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const deps = await db.select().from(mytoolTaskDependencies).where(or(eq(mytoolTaskDependencies.predecessorTaskId, taskId), eq(mytoolTaskDependencies.successorTaskId, taskId)));
      res.json(deps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/tasks/:id/dependencies", requireAuth, requireAdmin, async (req, res) => {
    try {
      const successorTaskId = Number(req.params.id);
      const predecessorTaskId = Number(req.body.predecessorTaskId);
      const dependencyType = req.body.dependencyType || "finish_to_start";
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

  app.delete("/api/mytool/tasks/:id/dependencies/:dependencyId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const dependencyId = Number(req.params.dependencyId);
      const [dep] = await db.select().from(mytoolTaskDependencies).where(eq(mytoolTaskDependencies.id, dependencyId));
      await db.delete(mytoolTaskDependencies).where(eq(mytoolTaskDependencies.id, dependencyId));
      if (dep) await refreshDependentTaskStates(dep.predecessorTaskId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/mytool/recurrence-templates", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const templates = await db.select().from(mytoolRecurrenceTemplates).orderBy(desc(mytoolRecurrenceTemplates.updatedAt));
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/recurrence-templates", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const [template] = await db.insert(mytoolRecurrenceTemplates).values({ ...req.body, ownerUserId: userId }).returning();
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - TIMEBLOCKS ====================

  app.get("/api/mytool/timeblocks", requireAuth, requireAdmin, async (req, res) => {
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

  app.post("/api/mytool/timeblocks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const block = await storage.createMytoolTimeblock({ ...req.body, ownerUserId: userId });
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "create", entityId: String(block.id), changesJson: { description: "Timeblock created" } });
      res.json(block);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/mytool/timeblocks/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const block = await storage.updateMytoolTimeblock(parseInt(req.params.id), req.body);
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "update", entityId: req.params.id, changesJson: { description: "Timeblock updated" } });
      res.json(block);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/timeblocks/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteMytoolTimeblock(parseInt(req.params.id));
      logAuditFromReq(req, { entityType: "mytool_timeblock", action: "delete", entityId: req.params.id, changesJson: { description: "Timeblock deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - DAILY REVIEWS ====================

  app.get("/api/mytool/daily-review", requireAuth, requireAdmin, async (req, res) => {
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

  app.put("/api/mytool/daily-review", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/mytool/escalated-priorities", requireAuth, requireAdmin, async (req, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== MY TOOL - USER PREFERENCES ====================

  app.get("/api/mytool/preferences", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const prefs = await storage.getMytoolUserPreferences(userId);
      res.json(prefs || { ownerUserId: userId, defaultView: 'today', workdayStartTime: '08:00', workdayEndTime: '17:00', showCompanyPriorities: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/mytool/preferences", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/mytool/email-links", requireAuth, requireAdmin, async (req, res) => {
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

  app.post("/api/mytool/email-links", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any)?.id || null;
      const link = await storage.createEmailLink({ ...req.body, createdBy: userId });
      logAuditFromReq(req, { entityType: "email_link", action: "create", entityId: String(link.id), changesJson: { description: "Email link created" } });
      res.json(link);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/email-links/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteEmailLink(parseInt(req.params.id));
      logAuditFromReq(req, { entityType: "email_link", action: "delete", entityId: req.params.id, changesJson: { description: "Email link deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // My Tool - DoD Templates
  app.get("/api/mytool/dod-templates", requireAuth, requireAdmin, async (req, res) => {
    try {
      const templates = await storage.getMytoolDodTemplates();
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/dod-templates", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const template = await storage.createMytoolDodTemplate({ ...req.body, createdBy: userId });
      logAuditFromReq(req, { entityType: "dod_template", action: "create", entityId: String(template.id), changesJson: { description: "DoD template created", title: req.body.title } });
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/mytool/dod-templates/:id", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/mytool/triage-rules", requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      const rules = await db.select().from(triageRulesTable).where(eq(triageRulesTable.ownerUserId, userId));
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/mytool/triage-rules", requireAuth, requireAdmin, async (req, res) => {
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

  app.patch("/api/mytool/triage-rules/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const ruleId = parseInt(req.params.id);
      const { triageRules: triageRulesTable } = await import("@shared/schema");
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

  app.delete("/api/mytool/triage-rules/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const ruleId = parseInt(req.params.id);
      const { triageRules: triageRulesTable } = await import("@shared/schema");
      await db.delete(triageRulesTable).where(eq(triageRulesTable.id, ruleId));
      logAuditFromReq(req, { entityType: "triage_rule", action: "delete", entityId: String(ruleId), changesJson: { description: "Triage rule deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TRIAGE INBOX ====================

  app.get("/api/mytool/triage-inbox", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/mytool/unclassified-tasks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { mytoolTasks: mytoolTasksTable } = await import("@shared/schema");
      const tasks = await db.select().from(mytoolTasksTable)
        .where(
          or(
            isNull(mytoolTasksTable.bucket),
            and(eq(mytoolTasksTable.bucket, 'project'), isNull(mytoolTasksTable.projectName))
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
      const tickets = await db.select().from(feedbackTickets).orderBy(desc(feedbackTickets.createdAt));
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
