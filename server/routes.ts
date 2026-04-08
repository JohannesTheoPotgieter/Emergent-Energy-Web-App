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
import { projectInfo, normalizedCostLines, normalizedRevenueLines, normalizedExecutionPhases, smartImportRuns, users, notifications, notificationThrottle, qcItemInstance, qcChecklist, qcTemplateItem, planEditNotifications, workItems, workItemAssignments, workItemDependencies, projectClientHistory, trItems, deliverables, cashflowPoints, financeRevenueMonthly, financeCosMonthly, manualEditFlags, programExpense, financialEditRequests, projectEngApprovals, approvals } from "@shared/schema";
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
import { getCosEffectiveDateAndSource } from "./lib/expense-row-selector";

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
import { normalizeStatus, normalizePriority } from "./lib/canonical-task-engine";
import { getFeatureFlag, getFeatureFlags } from "./lib/feature-flags";
import { requireTrackerPermission } from "./lib/finance-route-access";
import { registerAuthRoutes } from "./routes/auth-routes";
import {
  compareCoreProjectsReadiness,
  getCoreMasterDataReadinessReport,
  listProjectInfoFromPromotedCoreCompat,
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
import { registerWorkingPlanRoutes } from "./routes/working-plan-routes";
import { registerOperationalTasksRoutes } from "./routes/operational-tasks-routes";
import { registerCosControlRoutes } from "./routes/cos-control-routes";
import { registerPlanningTasksRoutes } from "./routes/planning-tasks-routes";
import { registerDashboardRoutes } from "./routes/dashboard-routes";

import { computeScheduleRag, computeCostRag, computeQualityRag, computeOverallRag, DEFAULT_RAG_THRESHOLDS } from "@shared/kpi-definitions";
import { STATIC_COS_BUDGET_FY26, classifyCosStatusFull } from "./lib/calculations/financeUtils";
import { isDateConfirmedCheck, getMergedExpensesAndInflows, resolveInflowEffectiveDates } from "./lib/cashflow-helpers";

function isCosRealisedCheck(exp: any): boolean {
  return classifyCosStatusFull(exp) === 'COS Realised';
}

// Unified realisation check: past-month committed costs are treated as realised.
function isEffectivelyRealisedLocal(exp: any, monthKey: string | null, currentMonthKey: string): boolean {
  const cosStatus = classifyCosStatusFull(exp);
  if (cosStatus === 'COS Realised' && (monthKey ? monthKey <= currentMonthKey : true)) return true;
  if (cosStatus === 'Committed' && monthKey != null && monthKey < currentMonthKey) return true;
  return false;
}

function isCashflowConfirmedCheck(exp: any): boolean {
  const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
  const hasPayDate = !!(exp.expensePaymentDate && String(exp.expensePaymentDate).trim());
  if (!hasInvoice || !hasPayDate) return false;
  const payDateConfirmed = isDateConfirmedCheck(exp.paymentDateConfirmed, exp.paymentDateFontColor);
  return payDateConfirmed;
}

const parityLogCooldownByKey = new Map<string, number>();
function shouldEmitParityLogSample(key: string, sampleRate = 0.2, minIntervalMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const last = parityLogCooldownByKey.get(key) ?? 0;
  if (now - last < minIntervalMs) return false;
  if (Math.random() > sampleRate) return false;
  parityLogCooldownByKey.set(key, now);
  return true;
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

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN") {
    return next();
  }
  res.status(403).json({ error: "admin_required", message: "Admin access required", code: "ADMIN_REQUIRED" });
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
    const resolvedPath = path.resolve(docUploadDir, path.basename(filename));
    if (!resolvedPath.startsWith(path.resolve(docUploadDir))) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }
    res.sendFile(resolvedPath);
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

  // REMOVED: /api/tracker-monthly and /api/cos-tracker duplicates.
  // Canonical routes now in finance-routes.ts

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

        // COS: uses canonical COS date for bucketing (respects admin overrides)
        const { date: cosDate } = getCosEffectiveDateAndSource(exp);
        if (cosDate) {
          const cosDateMatch = cosDate.match(/^(\d{4})-(\d{2})/);
          if (cosDateMatch) {
            const mk = `${cosDateMatch[1]}-${cosDateMatch[2]}`;
            const isCosReal = isEffectivelyRealisedLocal(exp, mk, currentMK);

            // Monthly series
            if (!cosMonthly.has(mk)) cosMonthly.set(mk, { total: 0, realised: 0 });
            const cm = cosMonthly.get(mk)!;
            cm.total += amount;
            if (isCosReal) cm.realised += amount;

            // Weekly buckets
            if (inRange(cosDate, thisWeekMon, thisWeekSun)) addToBucket(cosThisWeek, amount, isCosReal, pName);
            if (inRange(cosDate, lastWeekMon, lastWeekSun)) addToBucket(cosLastWeek, amount, isCosReal, pName);

            // Monthly buckets
            if (inRange(cosDate, thisMonthStart, thisMonthEnd)) addToBucket(cosThisMonth, amount, isCosReal, pName);
            if (inRange(cosDate, lastMonthStart, lastMonthEnd)) addToBucket(cosLastMonth, amount, isCosReal, pName);

            // YTD (within FY)
            if (inRange(cosDate, fyStart, fyEnd)) addToBucket(cosYTD, amount, isCosReal, pName);
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

  // REMOVED: /api/program-expenses and /api/program-expenses/:projectName
  // Canonical routes now in server/departments/finance-routes.ts (registered first via registerDepartmentRoutes).

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
        const diagFlag = await getFeatureFlag("migration_bridge_project_read_v1");
        if (diagFlag && comparison.status !== "ready" && shouldEmitParityLogSample("project_reads")) {
          console.warn("[promoted-read][projects] sampled mismatch summary", {
            status: comparison.status,
            mismatchCategories: comparison.mismatchCategories,
            legacyCount: comparison.legacyCount,
            promotedCount: comparison.promotedCount,
            missingInPromotedCount: comparison.missingInPromotedCount,
            extraInPromotedCount: comparison.extraInPromotedCount,
            fieldMismatchCount: comparison.fieldMismatchCount,
          });
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
        const diagFlag = await getFeatureFlag("migration_bridge_project_read_v1");
        if (diagFlag && comparison.status !== "ready" && shouldEmitParityLogSample("project_detail_reads")) {
          console.warn("[promoted-read][project-detail-master] sampled mismatch summary", {
            status: comparison.status,
            mismatchCategories: comparison.mismatchCategories,
            legacyCount: comparison.legacyCount,
            promotedCount: comparison.promotedCount,
            missingInPromotedCount: comparison.missingInPromotedCount,
            extraInPromotedCount: comparison.extraInPromotedCount,
            fieldMismatchCount: comparison.fieldMismatchCount,
          });
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

  // ==================== FINANCIAL DATA ROUTES ====================

  // REMOVED: /api/cashflow and /api/cashflow/planning-overrides duplicates.
  // Canonical routes now in finance-routes.ts

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

  // REMOVED: /api/revenue-tracking/overrides and /api/revenue-tab duplicates.
  // Canonical routes now in finance-routes.ts

  // REMOVED: /api/expenditure/overrides, /api/expense-task-links, /api/expenses duplicates.
  // Canonical routes now in finance-routes.ts

  // ==================== EXPENDITURE BREAKDOWN COMPOSITE API ====================

  app.patch("/api/expenditure/font-color-toggle", requireAuth, async (req, res) => {
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

  // Revenue tab routes (/api/revenue-tab/*) are now handled exclusively by finance-routes.ts
  // Legacy handlers removed to eliminate duplicate route registration that caused
  // the canonical handler (with governance context) to shadow the legacy one,
  // and to prevent confusion about which handler serves each request.

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

  // REMOVED: /api/expenditure-breakdown duplicate.
  // Canonical route now in finance-routes.ts

  // ==================== COS STATUS OVERRIDE API ====================

  app.post("/api/cos-status-override", requireAuth, async (req, res) => {
    try {
      const { expenseId, projectName, rowNumber, originalStatus, overrideStatus, reason } = req.body;
      if (!expenseId || !projectName || !overrideStatus || !reason) {
        return res.status(400).json({ error: "Missing required fields: expenseId, projectName, overrideStatus, reason" });
      }

      const userName = (req.user as any)?.username || (req.user as any)?.fullName || 'Unknown';

      // DEPRECATED: cosStatusOverrides table removed — override data baked into base rows
      // PE dual-write removed — normalized_cost_lines is canonical source

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

      // PE dual-write removed — normalized_cost_lines is canonical source
      // DEPRECATED: cosStatusOverrides table removed — override data baked into base rows

      logAuditFromReq(req, { entityType: "cos_override", action: "delete", entityId: String(expenseId), changesJson: { description: "COS status override removed" } });
      res.json({ success: true });
    } catch (error) {
      console.error("COS override delete error:", error);
      res.status(500).json({ error: "Failed to remove COS status override" });
    }
  });

  // REMOVED: /api/finance/revenue and /api/finance/cos duplicates.
  // Canonical routes now in finance-routes.ts

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


  return httpServer;
}
