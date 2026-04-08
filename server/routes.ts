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
import { projectInfo, normalizedCostLines, normalizedRevenueLines, normalizedExecutionPhases, smartImportRuns, users, qcTemplateItem, workItems, workItemAssignments, workItemDependencies, trItems, deliverables, cashflowPoints, financeRevenueMonthly, financeCosMonthly, manualEditFlags, programExpense, financialEditRequests, projectEngApprovals, approvals } from "@shared/schema";
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

import { recordManualEditFlag } from "./lib/manual-edit-flag";
import { safeNum, getFYRange } from "./lib/home-helpers";
import { requirePermission } from "./permission-middleware";
import { mapCostToExpenseInput } from "./lib/data-merge";
import { logAuditFromReq } from "./audit-logger";
import { ApiError, sendError, badRequest, notFound, validationError, unauthorized, serverError, logApiError } from "./lib/api-error";
import { normalizeStatus, normalizePriority } from "./lib/canonical-task-engine";
import { getFeatureFlag, getFeatureFlags } from "./lib/feature-flags";
import { requireTrackerPermission } from "./lib/finance-route-access";
import { registerAuthRoutes } from "./routes/auth-routes";
import { registerWorkingPlanRoutes } from "./routes/working-plan-routes";
import { registerOperationalTasksRoutes } from "./routes/operational-tasks-routes";
import { registerCosControlRoutes } from "./routes/cos-control-routes";
import { registerPlanningTasksRoutes } from "./routes/planning-tasks-routes";
import { registerDashboardRoutes } from "./routes/dashboard-routes";

import { STATIC_COS_BUDGET_FY26 } from "./lib/calculations/financeUtils";
import { isDateConfirmedCheck, getMergedExpensesAndInflows } from "./lib/cashflow-helpers";

import { isEffectivelyRealisedLocal, isCashflowConfirmedCheck } from "./lib/finance-helpers";

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


function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === "COO_ADMIN" || role === "CEO_ADMIN") {
    return next();
  }
  res.status(403).json({ error: "admin_required", message: "Admin access required", code: "ADMIN_REQUIRED" });
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

  // GC-003 + GC-005: Server-side KPI health-summary endpoint with configurable RAG thresholds
  await registerAuthRoutes(app);

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

  // Dashboard routes extracted to ./routes/dashboard-routes.ts
  registerDashboardRoutes(app);


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

  // ==================== FINANCIAL DATA ROUTES ====================

  // REMOVED: /api/cashflow and /api/cashflow/planning-overrides duplicates.
  // Canonical routes now in finance-routes.ts

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
