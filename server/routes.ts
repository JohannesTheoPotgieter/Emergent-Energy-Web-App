import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import multer from "multer";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { parseTrackerFile, applyFontColors } from "./excelParser";
import { insertBudgetSchema, programExpense, programInflows, projectInfo } from "@shared/schema";
import { db } from "./db";
import { z } from "zod";
import { format } from "date-fns";
import { generateToken, verifyToken } from "./jwt";
import { calculateCPM, applyOverridesToTasks, applyOverridesToDependencies, type CPMDependency } from "./cpmEngine";
import { classifyExpenseState } from "./lib/calculations/stateClassifier";
import { scoreExpenseConfidence, scoreInflowConfidence, getAssumptionDriver } from "./lib/calculations/confidence";
import { aggregateCOS, aggregateCOSByProject } from "./lib/calculations/cosAggregator";
import { computeWeeklyCashflow, getLinesForWeek, type CashflowLineItem } from "./lib/calculations/cashflow";
import { runDataQualityChecks } from "./lib/calculations/dataQuality";
import { buildOverrideMap, applyOverridesToCashflowLines, applyOverridesToCOSLines, computeMonthlyBuckets, getEffectiveDate } from "./lib/calculations/scenarioResolver";

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
function applyProjectPlanOverrides(
  baselineRows: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineRows;

  // Group overrides by rowNumber
  const overrideMap = new Map<number, Map<string, any>>();
  overrides.forEach((o: any) => {
    if (!overrideMap.has(o.rowNumber)) {
      overrideMap.set(o.rowNumber, new Map());
    }
    overrideMap.get(o.rowNumber)!.set(o.fieldName, o.overrideValue);
  });

  // Apply overrides to rows
  return baselineRows.map((row: any) => {
    if (!row.rowNumber || !overrideMap.has(row.rowNumber)) {
      return row;
    }
    const fieldOverrides = overrideMap.get(row.rowNumber)!;
    const updatedRow = { ...row };
    fieldOverrides.forEach((value, fieldName) => {
      updatedRow[fieldName] = value;
    });
    return updatedRow;
  });
}

// Apply revenue tracking overrides with type coercion
function applyRevenueTrackingOverrides(
  baselineRows: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineRows;

  const overrideMap = new Map<number, Map<string, any>>();
  overrides.forEach((o: any) => {
    if (!overrideMap.has(o.rowNumber)) {
      overrideMap.set(o.rowNumber, new Map());
    }
    overrideMap.get(o.rowNumber)!.set(o.fieldName, o.overrideValue);
  });

  return baselineRows.map((row: any) => {
    if (!row.rowNumber || !overrideMap.has(row.rowNumber)) {
      return row;
    }
    const fieldOverrides = overrideMap.get(row.rowNumber)!;
    const updatedRow = { ...row };
    fieldOverrides.forEach((value, fieldName) => {
      // Coerce inBank to number for consistent handling
      if (fieldName === 'inBank') {
        updatedRow[fieldName] = value === '1' || value === 1 || value === true ? 1 : 0;
      } else {
        updatedRow[fieldName] = value;
      }
    });
    return updatedRow;
  });
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

// Apply expenditure overrides
function applyExpenditureOverrides(
  baselineRows: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineRows;

  const overrideMap = new Map<number, Map<string, any>>();
  overrides.forEach((o: any) => {
    if (!overrideMap.has(o.rowNumber)) {
      overrideMap.set(o.rowNumber, new Map());
    }
    overrideMap.get(o.rowNumber)!.set(o.fieldName, o.overrideValue);
  });

  return baselineRows.map((row: any) => {
    if (!row.rowNumber || !overrideMap.has(row.rowNumber)) {
      return row;
    }
    const fieldOverrides = overrideMap.get(row.rowNumber)!;
    const updatedRow = { ...row };
    fieldOverrides.forEach((value, fieldName) => {
      updatedRow[fieldName] = value;
    });
    return updatedRow;
  });
}

// Apply finance revenue overrides
function applyFinanceRevenueOverrides(
  baselineData: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineData;

  const overrideMap = new Map<string, number>();
  overrides.forEach((o: any) => {
    const key = `${o.category}|${o.monthEndDate}`;
    const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
    if (!isNaN(numValue)) {
      overrideMap.set(key, numValue);
    }
  });

  return baselineData.map((row: any) => {
    const key = `${row.category}|${row.monthEndDate}`;
    if (overrideMap.has(key)) {
      return {
        ...row,
        value: overrideMap.get(key)!,
      };
    }
    return row;
  });
}

// Apply finance COS overrides
function applyFinanceCosOverrides(
  baselineData: any[],
  overrides: any[]
): any[] {
  if (overrides.length === 0) return baselineData;

  const overrideMap = new Map<string, number>();
  overrides.forEach((o: any) => {
    const key = `${o.category}|${o.monthEndDate}`;
    const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
    if (!isNaN(numValue)) {
      overrideMap.set(key, numValue);
    }
  });

  return baselineData.map((row: any) => {
    const key = `${row.category}|${row.monthEndDate}`;
    if (overrideMap.has(key)) {
      return {
        ...row,
        value: overrideMap.get(key)!,
      };
    }
    return row;
  });
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Check session-based auth first
  if (req.isAuthenticated()) {
    return next();
  }
  
  // Check JWT token as fallback
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    
    if (payload) {
      // Attach user to request for consistency
      req.user = {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
      return next();
    }
  }
  
  // Log diagnostic info for debugging
  const hasCookie = !!req.headers.cookie;
  const hasSession = !!req.session;
  const hasUser = !!req.user;
  const hasAuthHeader = !!authHeader;
  
  console.log(`[AUTH FAIL] hasCookie:${hasCookie}, hasSession:${hasSession}, hasUser:${hasUser}, hasAuthHeader:${hasAuthHeader}`);
  
  res.status(401).json({ error: "auth_required", message: "Authentication required", code: "AUTH_REQUIRED" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "admin_required", message: "Admin access required", code: "ADMIN_REQUIRED" });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== HEALTH CHECK ====================
  
  app.get("/api/health", async (req, res) => {
    const { dbMode } = await import("./db");
    const { getDbConfigStatus } = await import("./db-config");
    
    const dbStatus = getDbConfigStatus();
    
    // Check DB_MODE env var support
    const envDbMode = process.env.DB_MODE;
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    
    res.json({
      ok: dbStatus.connected,
      dbMode: dbMode,
      dbConnected: dbStatus.connected,
      dbHost: dbStatus.host,
      dbError: dbStatus.error || null,
      envDbMode: envDbMode || 'auto',
      hasDatabaseUrl,
      message: dbStatus.message,
      timestamp: new Date().toISOString(),
    });
  });
  
  // ==================== AUTH ROUTES ====================
  
  app.get("/api/auth/status", async (req, res) => {
    try {
      const { dbMode } = await import("./db");
      const { getDbConfigStatus } = await import("./db-config");
      const dbStatus = getDbConfigStatus();
      
      res.json({
        authenticated: req.isAuthenticated(),
        user: req.user ? { 
          email: req.user.email, 
          role: req.user.role 
        } : null,
        dbMode,
        dbConnected: dbStatus.connected,
      });
    } catch (error) {
      const errorMsg = "Failed to get auth status";
      res.status(500).json({ 
        error: errorMsg,
        message: errorMsg,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  app.post("/api/auth/login", async (req, res, next) => {
    const { dbMode } = await import("./db");
    
    passport.authenticate("local", (err: any, user: Express.User | false, info: { message: string }) => {
      if (err) {
        console.error("[LOGIN ERROR] Full error:", err);
        console.error("[LOGIN ERROR] Stack trace:", err.stack);
        
        // Provide better error messages for common DB connection issues
        if (err.message && (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED'))) {
          return res.status(503).json({ 
            error: "Database connection unavailable",
            message: "Database connection unavailable. Please check the database configuration.",
            detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
            code: 'DB_CONNECTION_ERROR',
            dbMode
          });
        }
        
        return res.status(500).json({ 
          error: "Server error during login",
          message: "An error occurred during login",
          detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
          code: 'LOGIN_ERROR',
          dbMode
        });
      }
      
      if (!user) {
        console.log("[LOGIN] Failed login attempt:", req.body?.email, "- Reason:", info?.message);
        return res.status(401).json({ 
          error: info?.message || "Invalid email or password",
          message: info?.message || "Login failed" 
        });
      }
      
      req.logIn(user, (err) => {
        if (err) {
          console.error("[SESSION ERROR]:", err);
          return res.status(500).json({ 
            error: "Failed to establish session",
            message: "Failed to establish session",
            detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
            code: 'SESSION_ERROR'
          });
        }
        
        console.log("[LOGIN] Successful login:", user.email);
        
        // Generate JWT token as fallback auth mechanism
        const token = generateToken({
          userId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        });
        
        return res.json({ 
          message: "Login successful", 
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          token,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed", message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    // Check session auth
    if (req.isAuthenticated() && req.user) {
      return res.json({ 
        user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role } 
      });
    }
    
    // Check JWT auth
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      
      if (payload) {
        return res.json({
          user: { id: payload.userId, email: payload.email, name: payload.name, role: payload.role }
        });
      }
    }
    
    res.status(401).json({ error: "Not authenticated", message: "Not authenticated" });
  });


  // ==================== OVERVIEW API ====================

  app.get("/api/overview", async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, allTaskLinks, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getLatestRefresh(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
      ]);

      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

      const today = new Date().toISOString().split("T")[0];

      // total_program_budget = SUM(project_info.contract_value)
      let totalProgramBudget = 0;
      for (const info of allProjectInfo) {
        if (info.contractValue) {
          totalProgramBudget += parseFloat(info.contractValue);
        }
      }
      
      // Fallback to sum of inflows if no contract values
      if (totalProgramBudget === 0) {
        for (const inflow of allInflows) {
          if (inflow.milestoneAmount) {
            totalProgramBudget += parseFloat(inflow.milestoneAmount);
          }
        }
      }

      // actual_spend_paid = SUM(expense_actual_total where payment_date is valid YYYY-MM-DD and <= today)
      let actualSpendPaid = 0;
      for (const expense of allExpenses) {
        const paymentDate = expense.expensePaymentDate;
        if (paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && paymentDate <= today && expense.expenseActualTotal) {
          actualSpendPaid += parseFloat(expense.expenseActualTotal);
        }
      }

      // revenue_realised = SUM(milestone_amount where effective date is valid and <= today)
      let revenueRealised = 0;
      for (const inflow of allInflows) {
        const paymentDate = inflow.effectiveDate;
        if (paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && paymentDate <= today && inflow.milestoneAmount) {
          revenueRealised += parseFloat(inflow.milestoneAmount);
        }
      }

      // active_projects = count distinct project names from ALL data sources (union)
      const uniqueProjects = new Set<string>();
      for (const info of allProjectInfo) {
        uniqueProjects.add(info.projectName);
      }
      for (const expense of allExpenses) {
        uniqueProjects.add(expense.projectName);
      }
      for (const inflow of allInflows) {
        uniqueProjects.add(inflow.projectName);
      }
      for (const plan of allPlans) {
        uniqueProjects.add(plan.projectName);
      }

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

  app.get("/api/home/summary", async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, rawInflows, allPlans, latestRefresh, revenueSummaries, allTaskLinks, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getLatestRefresh(),
        storage.getAllProjectRevenueSummaries(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
      ]);
      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

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

      // Calculate delta (actual% - expected%) per project from projectPlan
      const projectDeltas = new Map<string, { actual: number; expected: number; count: number }>();
      for (const plan of allPlans) {
        if (plan.actualPctComplete !== null && plan.expectedPctComplete !== null) {
          if (!projectDeltas.has(plan.projectName)) {
            projectDeltas.set(plan.projectName, { actual: 0, expected: 0, count: 0 });
          }
          const pd = projectDeltas.get(plan.projectName)!;
          pd.actual += plan.actualPctComplete;
          pd.expected += plan.expectedPctComplete;
          pd.count++;
        }
      }

      // Compute average delta per project
      const projectDeltaValues: { projectName: string; delta: number; avgActual: number; avgExpected: number }[] = [];
      for (const [projectName, pd] of Array.from(projectDeltas.entries())) {
        if (pd.count > 0) {
          const avgActual = pd.actual / pd.count;
          const avgExpected = pd.expected / pd.count;
          const delta = (avgActual - avgExpected) * 100; // Convert to percentage points
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

      // Upcoming events (next 7 days)
      const constructionStartSoon = allProjectInfo.filter(p => isWithinDays(p.constructionStartDate, 7)).length;
      const commissioningSoon = allProjectInfo.filter(p => isWithinDays(p.commissioningDate, 7)).length;
      const omHandoverSoon = allProjectInfo.filter(p => isWithinDays(p.omHandoverDate, 7)).length;
      const clientHandoverSoon = allProjectInfo.filter(p => isWithinDays(p.clientHandoverDate, 7)).length;

      // Due in 30 days
      const commissioningDue30 = allProjectInfo.filter(p => isWithinDays(p.commissioningDate, 30)).length;
      const omHandoverDue30 = allProjectInfo.filter(p => isWithinDays(p.omHandoverDate, 30)).length;
      const clientHandoverDue30 = allProjectInfo.filter(p => isWithinDays(p.clientHandoverDate, 30)).length;

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
        // Fallback: compute from raw program_inflows and program_expense
        for (const inflow of allInflows) {
          if (inflow.milestoneAmount) {
            actualRevenue += safeNum(inflow.milestoneAmount);
          }
        }
        for (const expense of allExpenses) {
          if (expense.expenseActualTotal) {
            actualExpenses += safeNum(expense.expenseActualTotal);
          }
        }
      }
      const grossProfit = actualRevenue - actualExpenses;
      const grossProfitPercent = actualRevenue > 0 ? (grossProfit / actualRevenue) * 100 : 0;

      // Revenue outstanding = invoiced but not received
      let revenueOutstanding = 0;
      for (const inf of allInflows) {
        if (inf.invoiceRaisedDate && !inf.paymentReceivedDate && inf.milestoneAmount) {
          revenueOutstanding += safeNum(inf.milestoneAmount);
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
      const missingCommissioning = allProjectInfo.filter(p => !p.commissioningDate).length;

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
  app.get("/api/home/notes", async (req, res) => {
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
      res.json(result);
    } catch (error) {
      console.error("Home notes save error:", error);
      res.status(500).json({ error: "Failed to save home notes" });
    }
  });

  // ==================== PROGRAM COS API (fixed) ====================

  app.get("/api/program/cos", async (req, res) => {
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

      // Total COS (Realised) = sum where invoice_raised_date exists within range
      let totalCosRealised = 0;
      let totalCashPaid = 0;
      let outstandingCos = 0;
      let atRiskCount = 0;
      let totalBudget = 0;
      const supplierMap = new Map<string, number>();
      const projectCosMap = new Map<string, number>();
      const monthlyCategoryMap = new Map<string, Map<string, number>>();

      for (const exp of filtered) {
        const invoiceDate = exp.expenseInvoicedDate;
        const paymentDate = exp.expensePaymentDate;
        const amount = safeNum(exp.expenseActualTotal);
        const cosAmount = safeNum(exp.actualCosTotal) || amount;
        const budgetAmount = safeNum(exp.budgetTotal);
        const category = exp.expenseCategory || 'Panels';

        totalBudget += budgetAmount;

        // COS Realised = has invoice date within range (and invoice number per requirement)
        if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd) {
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

        // Outstanding COS = invoiced but not paid, invoice within range
        if (invoiceDate && exp.expenseInvoiceNumber && invoiceDate >= filterStart && invoiceDate <= filterEnd && !paymentDate) {
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

  // Helper: find max ActualEndDate from plan tasks matching a description pattern
  function findMaxEndDate(plans: any[], patterns: string[]): string | null {
    let maxDate: string | null = null;
    for (const task of plans) {
      const desc = (task.highLevelProgramme || '').toLowerCase();
      const matches = patterns.some(p => desc.includes(p.toLowerCase()));
      if (matches && task.actualEnd && /^\d{4}-\d{2}-\d{2}/.test(task.actualEnd)) {
        const dateStr = task.actualEnd.substring(0, 10);
        if (!maxDate || dateStr > maxDate) maxDate = dateStr;
      }
    }
    return maxDate;
  }

  // Helper: compute DAYS diff between two date strings
  function daysDiff(a: string | null, b: string | null): number | null {
    if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
    const da = new Date(a.substring(0, 10));
    const db = new Date(b.substring(0, 10));
    const diff = Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  }

  app.get("/api/projects-summary", async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, rawInflows, allPlans, allEditableFields, allTaskLinks, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getAllProjectEditableFields(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
      ]);
      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

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

      const allProjectNames = new Set<string>();
      for (const info of allProjectInfo) allProjectNames.add(info.projectName);
      for (const expense of allExpenses) allProjectNames.add(expense.projectName);
      for (const inflow of allInflows) allProjectNames.add(inflow.projectName);
      for (const plan of allPlans) allProjectNames.add(plan.projectName);

      const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

      const projectsSummary = Array.from(allProjectNames).map(projectName => {
        const info = projectInfoMap.get(projectName);
        const projectExpenses = expensesByProject.get(projectName) || [];
        const projectInflows = inflowsByProject.get(projectName) || [];
        const projectPlans = plansByProject.get(projectName) || [];
        const editable = editableMap.get(projectName);

        // Compute milestone dates from plan tasks (Excel spec: max ActualEndDate matching descriptions)
        const pdHandoverDate = findMaxEndDate(projectPlans, ['bd handover', 'project charter handover']) || info?.pdHandoverDate || null;
        const constructionStartDate = findMaxEndDate(projectPlans, ['site establishment']) || info?.constructionStartDate || null;
        const commissioningDate = findMaxEndDate(projectPlans, ['commissioning']) || info?.commissioningDate || null;
        const omHandoverDate = findMaxEndDate(projectPlans, ['handover to matriarch']) || info?.omHandoverDate || null;
        const clientHandoverDate = findMaxEndDate(projectPlans, ['handover to client']) || info?.clientHandoverDate || null;

        // Duration = DAYS(Client Handover, Construction Start)
        const duration = daysDiff(clientHandoverDate, constructionStartDate);

        // kW/Week = Size / DAYS(Commissioning, Construction Start) * 7
        const sizeKwp = info?.sizeKwp ? parseFloat(info.sizeKwp) : null;
        const commDays = daysDiff(commissioningDate, constructionStartDate);
        const kwPerWeek = (sizeKwp && commDays && commDays > 0) ? (sizeKwp / commDays) * 7 : null;

        // Actual Revenue = SUM(MilstoneAmount) from ProgramInflows
        let actualRevenue = 0;
        for (const inflow of projectInflows) {
          if (inflow.milestoneAmount) actualRevenue += parseFloat(inflow.milestoneAmount);
        }

        // Actual Expenses = SUM(ExpenseActualTotal) from ProgramExpense
        let actualExpenses = 0;
        for (const expense of projectExpenses) {
          if (expense.expenseActualTotal) actualExpenses += parseFloat(expense.expenseActualTotal);
        }

        // GP % = 1 - (ActualExpenses / ActualRevenue); if revenue = 0 then null
        const gpPercent = actualRevenue > 0 ? 1 - (actualExpenses / actualRevenue) : null;

        // Project % Complete = avg(actual_pct_complete) across plan tasks
        const validActualPcts = projectPlans.filter(p => p.actualPctComplete !== null);
        const validExpectedPcts = projectPlans.filter(p => p.expectedPctComplete !== null);
        const projectPctComplete = validActualPcts.length > 0
          ? validActualPcts.reduce((sum, p) => sum + (p.actualPctComplete || 0), 0) / validActualPcts.length
          : null;
        const expectedPctComplete = validExpectedPcts.length > 0
          ? validExpectedPcts.reduce((sum, p) => sum + (p.expectedPctComplete || 0), 0) / validExpectedPcts.length
          : null;
        const deltaVsExpected = (projectPctComplete !== null && expectedPctComplete !== null)
          ? projectPctComplete - expectedPctComplete : null;

        // Revenue Outstanding (Excel spec): SUM(MilstoneAmount) where PaymentRecievedDate <= today AND MilestoneInvoiceNumber is blank
        let revenueOutstanding = 0;
        for (const inflow of projectInflows) {
          if (inflow.milestoneAmount) {
            const hasPayment = inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inflow.paymentReceivedDate) && inflow.paymentReceivedDate <= today;
            const noInvoice = !inflow.milestoneInvoiceNumber || inflow.milestoneInvoiceNumber.trim() === '';
            if (hasPayment && noInvoice) {
              revenueOutstanding += parseFloat(inflow.milestoneAmount);
            }
          }
        }

        // Expenses Due (Excel spec): SUM(ExpenseActualTotal) where ExpensePaymentDate < today AND ExpenseInvoiceNumber is blank
        let expensesDue = 0;
        for (const expense of projectExpenses) {
          if (expense.expenseActualTotal) {
            const hasPastPaymentDate = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(expense.expensePaymentDate) && expense.expensePaymentDate < today;
            const noInvoice = !expense.expenseInvoiceNumber || expense.expenseInvoiceNumber.trim() === '';
            if (hasPastPaymentDate && noInvoice) {
              expensesDue += parseFloat(expense.expenseActualTotal);
            }
          }
        }

        return {
          project_name: projectName,
          size_kwp: sizeKwp,
          pd: info?.pd || null,
          pm: info?.pm || null,
          cost_proposal_signed: editable?.costProposalSigned || null,
          funding_signed: editable?.fundingSigned || null,
          epc_contract_signed: editable?.epcContractSigned || null,
          phase: info?.phase || null,
          pd_handover_date: pdHandoverDate,
          construction_start_date: constructionStartDate,
          duration,
          kw_per_week: kwPerWeek,
          commissioning_date: commissioningDate,
          om_handover_date: omHandoverDate,
          client_handover_date: clientHandoverDate,
          project_pct_complete: projectPctComplete,
          expected_pct_complete: expectedPctComplete,
          delta_vs_expected: deltaVsExpected,
          actual_revenue: actualRevenue,
          actual_expenses: actualExpenses,
          gp_percent: gpPercent,
          revenue_outstanding: revenueOutstanding,
          expenses_due: expensesDue,
          current_vo_total: editable?.currentVoTotal ? parseFloat(editable.currentVoTotal) : 0,
          comments: editable?.comments || null
        };
      });

      res.json(projectsSummary);
    } catch (error) {
      console.error("Projects summary fetch error:", error);
      res.status(500).json({ error: "Failed to fetch projects summary", message: "Failed to fetch projects summary" });
    }
  });

  // Update project editable fields (Cost Proposal Signed, Funding Signed, EPC Contract Signed, Current VO Total, Comments)
  app.post("/api/projects-summary/:projectName/edit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName as string);
      const { costProposalSigned, fundingSigned, epcContractSigned, currentVoTotal, comments } = req.body;
      const result = await storage.upsertProjectEditableFields({
        projectName,
        costProposalSigned: costProposalSigned || null,
        fundingSigned: fundingSigned || null,
        epcContractSigned: epcContractSigned || null,
        currentVoTotal: currentVoTotal != null ? String(currentVoTotal) : null,
        comments: comments || null,
      });
      res.json(result);
    } catch (error) {
      console.error("Project edit error:", error);
      res.status(500).json({ error: "Failed to save project fields", message: "Failed to save project fields" });
    }
  });

  // ==================== CASHFLOW 2026 API ====================

  app.get("/api/cashflow-2026", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectFilter = req.query.project ? String(req.query.project) : null;

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
          if (projectFilter && inflow.projectName !== projectFilter) continue;
          const d = inflow.effectiveDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (d >= weekStart && d < weekEnd && inflow.milestoneAmount) {
            projectInflowsSum += parseFloat(inflow.milestoneAmount);
          }
        }

        let projectOutflowsSum = 0;
        for (const expense of allExpenses) {
          if (projectFilter && expense.projectName !== projectFilter) continue;
          const d = expense.expensePaymentDate;
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (d >= weekStart && d < weekEnd && expense.expenseActualTotal) {
            projectOutflowsSum += parseFloat(expense.expenseActualTotal);
          }
        }

        const computedOpening = runningBalance;
        const hasManualOverride = manualMap.has(weekStart);
        const openingBalance = hasManualOverride ? manualMap.get(weekStart)! : computedOpening;
        const balanceDelta = hasManualOverride ? openingBalance - computedOpening : 0;

        const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
        const monthlyOpex = opexMonthlyMap.get(mk) || 0;
        const weeksCount = weeksInMonth.get(mk) || 1;
        const computedOpex = monthlyOpex / weeksCount;
        const hasOpexOverride = opexWeeklyMap.has(weekStart);
        const opexOutflows = hasOpexOverride ? opexWeeklyMap.get(weekStart)! : computedOpex;

        const closingBalance = openingBalance + projectInflowsSum - opexOutflows - projectOutflowsSum;
        const availablePayment = openingBalance + projectInflowsSum;

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

  app.get("/api/cashflow-2026/detail", requireAuth, requireAdmin, async (req, res) => {
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
          if (projectFilter && e.projectName !== projectFilter) return false;
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

  app.post("/api/cashflow-2026/opening-balance", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/cashflow-2026/balance-history", requireAuth, requireAdmin, async (req, res) => {
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

  app.delete("/api/cashflow-2026/opening-balance", requireAuth, requireAdmin, async (req, res) => {
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

  app.post("/api/cashflow-2026/opex-budget", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/cashflow-2026/opex-budget", requireAuth, requireAdmin, async (req, res) => {
    try {
      const entries = await storage.getAllOpexBudgetMonthly();
      res.json(entries);
    } catch (error) {
      console.error("OPEX budget fetch error:", error);
      res.status(500).json({ error: "Failed to fetch OPEX budgets", message: "Failed to fetch OPEX budgets" });
    }
  });

  app.post("/api/cashflow-2026/opex-weekly", requireAuth, requireAdmin, async (req, res) => {
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

  app.delete("/api/cashflow-2026/opex-weekly", requireAuth, requireAdmin, async (req, res) => {
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

  app.post("/api/tracker-monthly", requireAuth, requireAdmin, async (req, res) => {
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
      res.json(result);
    } catch (error) {
      console.error("Tracker monthly save error:", error);
      res.status(500).json({ error: "Failed to save tracker entry", message: "Failed to save tracker entry" });
    }
  });

  app.get("/api/tracker-monthly/:type", requireAuth, requireAdmin, async (req, res) => {
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
            planned += parseFloat(inflow.milestoneAmount);
          }
        }

        const manual = manualMap.get(monthKey);
        const realised = manual?.realised ? parseFloat(manual.realised) : 0;
        const outstanding = manual?.outstanding ? parseFloat(manual.outstanding) : 0;
        const budget = manual?.budget ? parseFloat(manual.budget) : 0;

        const variance = planned - budget;
        const variancePct = budget !== 0 ? (planned - budget) / budget : 0;

        ytdPlanned += planned;
        ytdRealised += realised;
        ytdOutstanding += outstanding;
        ytdBudget += budget;
        const ytdVariance = ytdPlanned - ytdBudget;
        const ytdVariancePct = ytdBudget !== 0 ? (ytdPlanned - ytdBudget) / ytdBudget : 0;

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

  app.get("/api/cos-tracker", requireAuth, requireAdmin, async (req, res) => {
    try {
      const [allProgramExpenses, manualEntries] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getTrackerMonthlyManual('COS'),
      ]);

      const manualMap = new Map(manualEntries.map(e => [e.monthKey, e]));

      const cosByMonth = new Map<string, { total: number; projects: Map<string, number> }>();
      const realisedByMonth = new Map<string, { total: number; projects: Map<string, number> }>();

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

        const hasInvoice = !!exp.expenseInvoiceNumber;
        const dateConfirmed = exp.invoiceDateConfirmed === true;
        const isRealised = hasInvoice && dateConfirmed;

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

      let ytdCOS = 0, ytdBudget = 0, ytdRealised = 0;

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
        const realisedCOS = realisedBucket?.total ?? 0;
        const unrealisedCOS = totalCOS - realisedCOS;

        const manual = manualMap.get(monthKey);
        const budget = manual?.budget ? parseFloat(manual.budget) : (staticCosBudget[monthKey] ?? 0);

        const variance = totalCOS - budget;
        const variancePct = budget !== 0 ? variance / budget : 0;

        ytdCOS += totalCOS;
        ytdRealised += realisedCOS;
        ytdBudget += budget;
        const ytdUnrealised = ytdCOS - ytdRealised;
        const ytdVariance = ytdCOS - ytdBudget;
        const ytdVariancePct = ytdBudget !== 0 ? ytdVariance / ytdBudget : 0;

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

  app.get("/api/cos-tracker/month-detail", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { monthKey, project, state: stateFilter } = req.query as { monthKey?: string; project?: string; state?: string };
      if (!monthKey) return res.status(400).json({ error: "monthKey required" });

      const match = monthKey.match(/^(\d{4})-(\d{2})$/);
      if (!match) return res.status(400).json({ error: "Invalid monthKey format" });

      const allExpenses = await storage.getAllProgramExpenses();

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

        const hasInvoice = !!exp.expenseInvoiceNumber;
        const dateConfirmed = exp.invoiceDateConfirmed === true;
        const isRealised = hasInvoice && dateConfirmed;

        let cosState = 'Planned';
        if (exp.expensePaymentDate && exp.paymentDateConfirmed) {
          cosState = 'Paid';
        } else if (hasInvoice && dateConfirmed) {
          cosState = 'Invoiced';
        } else if (exp.expensePoNumber) {
          cosState = 'Committed';
        }

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
          invoiceDateConfirmed: dateConfirmed,
          paymentDate: payDate,
          paymentDateConfirmed: exp.paymentDateConfirmed === true,
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

  // ==================== PROGRAM DASHBOARD API ====================

  app.get("/api/program-dashboard", requireAuth, requireAdmin, async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, rawInflows, allPlans, allEditableFields, allTaskLinks, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getAllProjectEditableFields(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
      ]);
      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

      const today = new Date().toISOString().split("T")[0];

      const plansByProject = new Map<string, typeof allPlans>();
      for (const plan of allPlans) {
        if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
        plansByProject.get(plan.projectName)!.push(plan);
      }

      const inflowsByProject = new Map<string, typeof allInflows>();
      for (const inflow of allInflows) {
        if (!inflowsByProject.has(inflow.projectName)) inflowsByProject.set(inflow.projectName, []);
        inflowsByProject.get(inflow.projectName)!.push(inflow);
      }

      const expensesByProject = new Map<string, typeof allExpenses>();
      for (const expense of allExpenses) {
        if (!expensesByProject.has(expense.projectName)) expensesByProject.set(expense.projectName, []);
        expensesByProject.get(expense.projectName)!.push(expense);
      }

      const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

      const allProjectNames = new Set<string>();
      for (const info of allProjectInfo) allProjectNames.add(info.projectName);
      for (const expense of allExpenses) allProjectNames.add(expense.projectName);
      for (const inflow of allInflows) allProjectNames.add(inflow.projectName);
      for (const plan of allPlans) allProjectNames.add(plan.projectName);

      let siteEstablishmentNext10 = 0;
      let commissioningNext10 = 0;
      let omHandoverNext10 = 0;
      let clientHandoverNext10 = 0;
      let revenueOutstanding = 0;
      let expenseOverdue = 0;
      let inflowsThisWeek = 0;
      let outflowsThisWeek = 0;

      const siteEstablishmentProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
      const commissioningProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
      const omHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
      const clientHandoverProjects: Array<{ projectName: string; date: string; pm: string | null }> = [];
      const revenueOutstandingProjects: Array<{ projectName: string; amount: number; milestone: string | null }> = [];
      const expenseOverdueProjects: Array<{ projectName: string; amount: number; lineItem: string | null }> = [];
      const inflowProjects: Array<{ projectName: string; amount: number }> = [];
      const outflowProjects: Array<{ projectName: string; amount: number }> = [];

      const pmStats = new Map<string, { activeProjects: number; commissioningThisMonth: number; clientHandoverThisMonth: number }>();

      for (const projectName of Array.from(allProjectNames)) {
        const info = projectInfoMap.get(projectName);
        const projectPlans = plansByProject.get(projectName) || [];
        const projectInflows = inflowsByProject.get(projectName) || [];
        const projectExpenses = expensesByProject.get(projectName) || [];

        const constructionStartDate = findMaxEndDate(projectPlans, ['site establishment']) || info?.constructionStartDate || null;
        const commissioningDate = findMaxEndDate(projectPlans, ['commissioning']) || info?.commissioningDate || null;
        const omHandoverDate = findMaxEndDate(projectPlans, ['handover to matriarch']) || info?.omHandoverDate || null;
        const clientHandoverDate = findMaxEndDate(projectPlans, ['handover to client']) || info?.clientHandoverDate || null;

        if (isWithinDays(constructionStartDate, 10)) {
          siteEstablishmentNext10++;
          siteEstablishmentProjects.push({ projectName, date: constructionStartDate!, pm: info?.pm || null });
        }
        if (isWithinDays(commissioningDate, 10)) {
          commissioningNext10++;
          commissioningProjects.push({ projectName, date: commissioningDate!, pm: info?.pm || null });
        }
        if (isWithinDays(omHandoverDate, 10)) {
          omHandoverNext10++;
          omHandoverProjects.push({ projectName, date: omHandoverDate!, pm: info?.pm || null });
        }
        if (isWithinDays(clientHandoverDate, 10)) {
          clientHandoverNext10++;
          clientHandoverProjects.push({ projectName, date: clientHandoverDate!, pm: info?.pm || null });
        }

        let projRevOutstanding = 0;
        for (const inflow of projectInflows) {
          if (inflow.milestoneAmount) {
            const hasPayment = inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}$/.test(inflow.paymentReceivedDate) && inflow.paymentReceivedDate <= today;
            const noInvoice = !inflow.milestoneInvoiceNumber || inflow.milestoneInvoiceNumber.trim() === '';
            if (hasPayment && noInvoice) {
              const amt = parseFloat(inflow.milestoneAmount);
              revenueOutstanding += amt;
              projRevOutstanding += amt;
            }
          }
          if (isThisWeek(inflow.effectiveDate) && inflow.milestoneAmount) {
            inflowsThisWeek += parseFloat(inflow.milestoneAmount);
          }
        }
        if (projRevOutstanding > 0) {
          revenueOutstandingProjects.push({ projectName, amount: projRevOutstanding, milestone: null });
        }

        let projInflowsWeek = 0;
        let projOutflowsWeek = 0;
        for (const inflow of projectInflows) {
          if (isThisWeek(inflow.effectiveDate) && inflow.milestoneAmount) {
            projInflowsWeek += parseFloat(inflow.milestoneAmount);
          }
        }
        if (projInflowsWeek > 0) {
          inflowProjects.push({ projectName, amount: projInflowsWeek });
        }

        let projExpOverdue = 0;
        for (const expense of projectExpenses) {
          if (expense.expenseActualTotal) {
            const hasPastPaymentDate = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}$/.test(expense.expensePaymentDate) && expense.expensePaymentDate < today;
            const noInvoice = !expense.expenseInvoiceNumber || expense.expenseInvoiceNumber.trim() === '';
            if (hasPastPaymentDate && noInvoice) {
              const amt = parseFloat(expense.expenseActualTotal);
              expenseOverdue += amt;
              projExpOverdue += amt;
            }
          }
          if (isThisWeek(expense.expensePaymentDate) && expense.expenseActualTotal) {
            projOutflowsWeek += parseFloat(expense.expenseActualTotal);
          }
        }
        if (projExpOverdue > 0) {
          expenseOverdueProjects.push({ projectName, amount: projExpOverdue, lineItem: null });
        }
        outflowsThisWeek += projOutflowsWeek;
        if (projOutflowsWeek > 0) {
          outflowProjects.push({ projectName, amount: projOutflowsWeek });
        }

        const pm = info?.pm;
        if (pm) {
          if (!pmStats.has(pm)) pmStats.set(pm, { activeProjects: 0, commissioningThisMonth: 0, clientHandoverThisMonth: 0 });
          const stats = pmStats.get(pm)!;
          if (clientHandoverDate && clientHandoverDate >= today) {
            stats.activeProjects++;
          }
          if (isThisMonth(commissioningDate)) {
            stats.commissioningThisMonth++;
          }
          if (isThisMonth(clientHandoverDate)) {
            stats.clientHandoverThisMonth++;
          }
        }
      }

      const pmTable = Array.from(pmStats.entries()).map(([pm, stats]) => ({
        pm,
        ...stats,
      }));

      res.json({
        kpis: {
          siteEstablishmentNext10,
          commissioningNext10,
          omHandoverNext10,
          clientHandoverNext10,
          revenueOutstanding,
          expenseOverdue,
          inflowsThisWeek,
          outflowsThisWeek,
        },
        kpiDetails: {
          siteEstablishmentProjects,
          commissioningProjects,
          omHandoverProjects,
          clientHandoverProjects,
          revenueOutstandingProjects: revenueOutstandingProjects.sort((a, b) => b.amount - a.amount),
          expenseOverdueProjects: expenseOverdueProjects.sort((a, b) => b.amount - a.amount),
          inflowProjects: inflowProjects.sort((a, b) => b.amount - a.amount),
          outflowProjects: outflowProjects.sort((a, b) => b.amount - a.amount),
        },
        pmTable,
      });
    } catch (error) {
      console.error("Program dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch program dashboard", message: "Failed to fetch program dashboard" });
    }
  });

  app.get("/api/dashboard/high-priority", requireAuth, requireAdmin, async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, rawInflows, allPlans, allTaskLinks, allOpTasks] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
      ]);

      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlans);

      const today = new Date().toISOString().split("T")[0];
      const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

      const overdueExpenses: Array<{
        projectName: string;
        lineItem: string | null;
        invoiceNumber: string | null;
        poNumber: string | null;
        amount: number;
        paymentDate: string;
        severity: string;
      }> = [];

      for (const expense of allExpenses) {
        if (expense.expenseActualTotal && expense.expensePaymentDate) {
          const amt = parseFloat(expense.expenseActualTotal);
          if (amt > 0 && expense.expensePaymentDate < today && (!expense.expenseInvoiceNumber || expense.expenseInvoiceNumber.trim() === '')) {
            overdueExpenses.push({
              projectName: expense.projectName,
              lineItem: expense.expenseLineItem,
              invoiceNumber: expense.expenseInvoiceNumber,
              poNumber: expense.expensePoNumber,
              amount: amt,
              paymentDate: expense.expensePaymentDate,
              severity: amt >= 500000 ? "Critical" : amt >= 100000 ? "High" : "Medium",
            });
          }
        }
      }
      overdueExpenses.sort((a, b) => b.amount - a.amount);

      const revenueOutstanding: Array<{
        projectName: string;
        milestoneName: string | null;
        invoiceNumber: string | null;
        amount: number;
        dueDate: string | null;
        severity: string;
      }> = [];

      for (const inflow of allInflows) {
        if (inflow.milestoneAmount) {
          const amt = parseFloat(inflow.milestoneAmount);
          if (amt > 0 && !inflow.paymentReceivedDate) {
            revenueOutstanding.push({
              projectName: inflow.projectName,
              milestoneName: inflow.milestoneName,
              invoiceNumber: inflow.milestoneInvoiceNumber,
              amount: amt,
              dueDate: inflow.effectiveDate || inflow.invoiceRaisedDate || null,
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
        if (!plansByProject.has(plan.projectName)) plansByProject.set(plan.projectName, []);
        plansByProject.get(plan.projectName)!.push(plan);
      }

      for (const [projectName, plans] of Array.from(plansByProject.entries())) {
        const completions = plans.filter((p: any) => p.percentComplete != null && p.expectedProgress != null);
        if (completions.length > 0) {
          const avgActual = completions.reduce((sum: number, p: any) => sum + (parseFloat(p.percentComplete) || 0), 0) / completions.length;
          const avgExpected = completions.reduce((sum: number, p: any) => sum + (parseFloat(p.expectedProgress) || 0), 0) / completions.length;
          const delta = avgActual - avgExpected;
          if (delta < -0.05) {
            const info = projectInfoMap.get(projectName);
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
      }> = [];

      const milestoneTypes = [
        { patterns: ['site establishment'], label: 'Site Establishment' },
        { patterns: ['commissioning'], label: 'Commissioning' },
        { patterns: ['handover to matriarch', 'o&m handover'], label: 'O&M Handover' },
        { patterns: ['handover to client', 'client handover'], label: 'Client Handover' },
      ];

      for (const [projectName, plans] of Array.from(plansByProject.entries())) {
        const info = projectInfoMap.get(projectName);
        for (const mt of milestoneTypes) {
          const endDate = findMaxEndDate(plans, mt.patterns);
          if (endDate && isWithinDays(endDate, 10)) {
            upcomingMilestones.push({
              projectName,
              milestoneType: mt.label,
              date: endDate,
              pm: info?.pm || null,
            });
          }
        }
      }
      upcomingMilestones.sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        overdueExpenses: overdueExpenses.slice(0, 15),
        revenueOutstanding: revenueOutstanding.slice(0, 15),
        projectsBehindPlan: projectsBehindPlan.slice(0, 10),
        upcomingMilestones,
      });
    } catch (error) {
      console.error("High priority API error:", error);
      res.status(500).json({ error: "Failed to fetch high priority items" });
    }
  });

  // ==================== DASHBOARD DATA ROUTES ====================

  app.get("/api/dashboard", async (req, res) => {
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

  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch projects", message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found", message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project", message: "Failed to fetch project" });
    }
  });

  // ==================== EXPENSES ROUTES ====================

  app.get("/api/expenses", async (req, res) => {
    try {
      const { projectId } = req.query;
      if (projectId && typeof projectId === 'string') {
        const expenses = await storage.getExpensesByProject(parseInt(projectId));
        return res.json(expenses);
      }
      const expenses = await storage.getAllExpenses();
      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expenses", message: "Failed to fetch expenses" });
    }
  });

  // ==================== REVENUES ROUTES ====================

  app.get("/api/revenues", async (req, res) => {
    try {
      const { projectId } = req.query;
      if (projectId && typeof projectId === 'string') {
        const revenues = await storage.getRevenuesByProject(parseInt(projectId));
        return res.json(revenues);
      }
      const revenues = await storage.getAllRevenues();
      res.json(revenues);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch revenues", message: "Failed to fetch revenues" });
    }
  });

  // ==================== TASKS ROUTES ====================

  app.get("/api/tasks", async (req, res) => {
    try {
      const { projectId } = req.query;
      if (projectId && typeof projectId === 'string') {
        const tasks = await storage.getTasksByProject(parseInt(projectId));
        return res.json(tasks);
      }
      const tasks = await storage.getAllTasks();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks", message: "Failed to fetch tasks" });
    }
  });

  // ==================== BUDGETS ROUTES (Admin Only) ====================

  app.get("/api/budgets", async (req, res) => {
    try {
      const budgets = await storage.getAllBudgets();
      res.json(budgets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch budgets", message: "Failed to fetch budgets" });
    }
  });

  app.post("/api/budgets", requireAuth, requireAdmin, async (req, res) => {
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

  app.delete("/api/budgets/:id", requireAuth, requireAdmin, async (req, res) => {
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

  // ==================== FILE UPLOAD ROUTE ====================

  // Accept multiple field names: files, file, tracker, trackers
  const multiUpload = upload.fields([
    { name: 'files', maxCount: 20 },
    { name: 'file', maxCount: 20 },
    { name: 'tracker', maxCount: 20 },
    { name: 'trackers', maxCount: 20 }
  ]);

  app.post("/api/upload", requireAuth, requireAdmin, multiUpload, async (req, res) => {
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
          const parseResult = parseTrackerFile(fileBuffer, file.originalname);
          
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

            // Insert project info
            if (parseResult.projectInfo) {
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
        
        // Extract project name from filename
        const projectName = upload.fileName.replace(/_Tracker\.(xlsx|xlsm|xls)$/i, '');
        
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
          const parseResult = parseTrackerFile(fileBuffer, fileInfo.fileName);
          
          await applyFontColors(parseResult.expenses, fileBuffer);
          
          // Delete existing data for this project
          await storage.deleteProgramExpensesByProject(parseResult.projectName);
          await storage.deleteProgramInflowsByProject(parseResult.projectName);
          await storage.deleteProjectPlansByProject(parseResult.projectName);
          await storage.deleteCashflowPointsByProject(parseResult.projectName);
          await storage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
          await storage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
          
          // Re-insert all data
          if (parseResult.projectInfo) {
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

  app.get("/api/program-expenses", async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let expenses;
      
      if (projectName && typeof projectName === 'string') {
        expenses = await storage.getProgramExpensesByProject(projectName);
        
        // Apply overrides if requested
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

  // Parameterized route for fetching expenses by project name in URL path
  app.get("/api/program-expenses/:projectName", async (req, res) => {
    try {
      const { projectName } = req.params;
      const { applyOverrides } = req.query;
      
      let expenses = await storage.getProgramExpensesByProject(projectName);
      
      // Apply overrides if requested
      if (applyOverrides === 'true') {
        const overrides = await storage.getExpenditureOverridesByProject(projectName);
        expenses = applyExpenditureOverrides(expenses, overrides);
      }

      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch program expenses", message: "Failed to fetch program expenses" });
    }
  });

  app.get("/api/program-inflows", async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let inflows;
      
      if (projectName && typeof projectName === 'string') {
        inflows = await storage.getProgramInflowsByProject(projectName);
        
        // Apply overrides if requested
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

  app.get("/api/project-plans", async (req, res) => {
    try {
      const { projectName, applyOverrides } = req.query;
      let plans;
      
      if (projectName && typeof projectName === 'string') {
        plans = await storage.getProjectPlansByProject(projectName);
        
        // Apply overrides if requested
        if (applyOverrides === 'true') {
          const overrides = await storage.getProjectPlanOverridesByProject(projectName);
          plans = applyProjectPlanOverrides(plans, overrides);
        }
        return res.json(plans);
      }
      plans = await storage.getAllProjectPlans();
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plans", message: "Failed to fetch project plans" });
    }
  });

  app.get("/api/project-plan/:projectName", async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const { applyOverrides } = req.query;
      
      let plans = await storage.getProjectPlansByProject(projectName);
      
      if (applyOverrides === 'true') {
        const overrides = await storage.getProjectPlanOverridesByProject(projectName);
        plans = applyProjectPlanOverrides(plans, overrides);
      }
      
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plan", message: "Failed to fetch project plan", code: "PROJECT_PLAN_ERROR" });
    }
  });

  app.get("/api/project-info", async (req, res) => {
    try {
      const info = await storage.getAllProjectInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project info", message: "Failed to fetch project info" });
    }
  });

  // ==================== FINANCIAL DATA ROUTES ====================

  app.get("/api/cashflow", async (req, res) => {
    try {
      // Support both 'project' and 'projectName' params for consistency
      const projectParam = req.query.project || req.query.projectName;
      const { startDate, endDate } = req.query;
      const projectName = (projectParam && typeof projectParam === 'string') ? projectParam : null;
      
      let points;
      if (projectName) {
        points = await storage.getCashflowPointsByProject(projectName);
      } else {
        points = await storage.getAllCashflowPoints();
      }

      // Apply planning overrides to baseline data
      const overrides = await storage.getAllPlanningOverrides();
      points = applyPlanningOverrides(points, overrides);

      // Calculate Revenue Recognition from expenses (COS invoicing milestones)
      const expenses = projectName 
        ? await storage.getProgramExpensesByProject(projectName)
        : await storage.getAllProgramExpenses();
      
      const { weekly, cumulative } = calculateRevenueRecognition(expenses, projectName);
      
      // Add Revenue Recognition points to the cashflow data
      Array.from(weekly.entries()).forEach(([pName, weeklyData]) => {
        Array.from(weeklyData.entries()).forEach(([weekStart, amount]) => {
          points.push({
            id: null, // Virtual point
            projectName: pName,
            seriesName: "Revenue Recognition",
            pointDate: weekStart,
            value: amount.toString(),
            createdAt: null
          });
        });
      });
      
      // Add Revenue Recognition Cumulative points
      Array.from(cumulative.entries()).forEach(([pName, cumulativeData]) => {
        Array.from(cumulativeData.entries()).forEach(([weekStart, amount]) => {
          points.push({
            id: null, // Virtual point
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

  // Planning overrides API
  app.get("/api/cashflow/planning-overrides", async (req, res) => {
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

  app.post("/api/cashflow/planning-overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides } = req.body;
      
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }

      // Add createdBy from authenticated user and validate override values
      const userId = req.user?.id;
      const overridesWithUser = overrides.map(o => {
        // Ensure overrideValue is a valid number
        const numValue = typeof o.overrideValue === 'string' ? parseFloat(o.overrideValue) : o.overrideValue;
        if (isNaN(numValue)) {
          throw new Error(`Invalid override value: ${o.overrideValue}`);
        }
        return { 
          ...o, 
          overrideValue: numValue.toString(), // Store as string in DB but validate it's numeric
          createdBy: userId 
        };
      });

      const saved = await storage.upsertManyPlanningOverrides(overridesWithUser);
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
      res.json({ message: `Planning overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete planning overrides", message: "Failed to delete planning overrides" });
    }
  });

  // Project Plan Overrides API
  app.get("/api/project-plan/overrides", async (req, res) => {
    try {
      const { projectName } = req.query;
      if (!projectName || typeof projectName !== 'string') {
        return res.status(400).json({ error: "Project name required", message: "Project name is required" });
      }
      const overrides = await storage.getProjectPlanOverridesByProject(projectName);
      res.json(overrides);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project plan overrides", message: "Failed to fetch project plan overrides" });
    }
  });

  app.post("/api/project-plan/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const userId = req.user?.id;
      const overridesWithUser = overrides.map(o => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyProjectPlanOverrides(overridesWithUser);
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
      res.json({ message: `Project plan overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete project plan overrides", message: "Failed to delete project plan overrides" });
    }
  });

  // Revenue Tracking Overrides API
  app.get("/api/revenue-tracking/overrides", async (req, res) => {
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

  app.post("/api/revenue-tracking/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const userId = req.user?.id;
      const overridesWithUser = overrides.map(o => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyRevenueTrackingOverrides(overridesWithUser);
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
      res.json({ message: `Revenue tracking overrides deleted for project: ${projectName}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete revenue tracking overrides", message: "Failed to delete revenue tracking overrides" });
    }
  });

  app.get("/api/revenue-tab/:projectName", async (req, res) => {
    try {
      const projectName = req.params.projectName;

      const [rawInflows, overrides, projectInfoList, savedSummary, operationalTasks, planTasks, taskLinks] = await Promise.all([
        storage.getProgramInflowsByProject(projectName),
        storage.getRevenueTrackingOverridesByProject(projectName),
        storage.getAllProjectInfo(),
        storage.getProjectRevenueSummary(projectName),
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
        storage.getMilestoneTaskLinks(projectName),
      ]);

      const inflows = applyRevenueTrackingOverrides(rawInflows, overrides);

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
        const inBank = r.inBank === 1 || r.inBank === '1' || r.inBank === true;

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
            const hasPaid = !!(row as any).expensePaymentDate && /^\d{4}-\d{2}-\d{2}/.test((row as any).expensePaymentDate);
            const hasInvoice = !!((row as any).expenseInvoiceNumber && (row as any).expenseInvoiceNumber.trim());
            const hasPO = !!((row as any).expensePoNumber && (row as any).expensePoNumber.trim());
            if (hasPaid && hasInvoice && hasPO && actualAmt > 0) {
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
        res.json({ success: true });
      } else {
        await storage.upsertMilestoneTaskLink(projectName, milestoneRowNumber, 0);
        await storage.updateMilestoneDateOverride(projectName, milestoneRowNumber, dateOverride, reason || null);
        res.json({ success: true });
      }
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
      res.json({ success: true });
    } catch (error) {
      console.error("Unlink task error:", error);
      res.status(500).json({ error: "Failed to unlink task" });
    }
  });

  // Expenditure Overrides API
  app.get("/api/expenditure/overrides", async (req, res) => {
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

  app.post("/api/expenditure/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const userId = req.user?.id;
      const overridesWithUser = overrides.map(o => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyExpenditureOverrides(overridesWithUser);
      res.json({ message: "Expenditure overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
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
      res.json(link);
    } catch (error) {
      console.error("Link expense task error:", error);
      res.status(500).json({ error: "Failed to link task" });
    }
  });

  app.delete("/api/expense-task-links/:projectName/:expenseId", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteExpenseTaskLink(req.params.projectName, parseInt(req.params.expenseId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unlink task" });
    }
  });

  app.post("/api/expense-task-links/:projectName/:expenseId/date-override", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { dateOverride, reason } = req.body;
      await storage.updateExpenseTaskLinkDateOverride(req.params.projectName, parseInt(req.params.expenseId), dateOverride, reason);
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
      });
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
      });
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
      });
      await storage.upsertExpenseTaskLink(projectName, newExpense.id, taskId, (req.user as any)?.id);
      res.json(newExpense);
    } catch (error) {
      console.error("Insert task as line error:", error);
      res.status(500).json({ error: "Failed to insert task as line item" });
    }
  });

  // ==================== EXPENDITURE BREAKDOWN COMPOSITE API ====================

  app.get("/api/expenditure-breakdown/:projectName", requireAuth, requireAdmin, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const [expenses, taskLinks, opTasks, planTasks] = await Promise.all([
        storage.getProgramExpensesByProject(projectName),
        storage.getExpenseTaskLinks(projectName),
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
      ]);

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
        const hasInvoiceDate = !!(exp.expenseInvoicedDate && /^\d{4}-\d{2}-\d{2}/.test(exp.expenseInvoicedDate));
        const invoiceDateActual = exp.invoiceDateFontColor !== 'red';
        const hasPaymentDate = !!(exp.expensePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(exp.expensePaymentDate));
        const paymentDateActual = exp.paymentDateFontColor !== 'red';

        let cosStatus: string;
        if (hasInvoice && hasInvoiceDate && invoiceDateActual && hasPaymentDate && paymentDateActual) {
          cosStatus = 'COS Realised';
        } else if (hasInvoice && hasInvoiceDate) {
          cosStatus = 'Not Yet Realised';
        } else if (hasPO || hasInvoice) {
          cosStatus = 'Not Yet Realised';
        } else {
          cosStatus = 'Planned';
        }

        let paymentStatus: string;
        if (hasInvoice && hasPaymentDate && paymentDateActual) {
          paymentStatus = 'Paid';
        } else if (hasPaymentDate && !paymentDateActual) {
          paymentStatus = 'Payment Planned';
        } else if (hasInvoice && !hasPaymentDate) {
          paymentStatus = 'Invoiced';
        } else if (hasPO) {
          paymentStatus = 'Committed';
        } else {
          paymentStatus = 'Planned';
        }

        const effectivePaymentDate = link?.dateOverride || linkedTask?.dueDate || exp.expensePaymentDate || exp.forecastPaymentDate || null;
        let plannedMonth: string | null = null;
        if (effectivePaymentDate && /^\d{4}-\d{2}-\d{2}/.test(effectivePaymentDate)) {
          const d = new Date(effectivePaymentDate);
          plannedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }

        return {
          ...exp,
          linkedTask,
          cosStatus,
          paymentStatus,
          effectivePaymentDate,
          plannedMonth,
          hasDateOverride: !!link?.dateOverride,
          dateOverrideReason: link?.dateOverrideReason || null,
        };
      });

      const categories = [...new Set(expenses.filter((e: any) => e.rowType === 'category').map((e: any) => e.expenseCategory).filter(Boolean))];

      res.json({ items: enriched, categories });
    } catch (error) {
      console.error("Expenditure breakdown error:", error);
      res.status(500).json({ error: "Failed to fetch expenditure breakdown" });
    }
  });

  // Finance Revenue Overrides API
  app.get("/api/finance/revenue/overrides", async (req, res) => {
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

  app.post("/api/finance/revenue/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const userId = req.user?.id;
      const overridesWithUser = overrides.map(o => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyFinanceRevenueOverrides(overridesWithUser);
      res.json({ message: "Finance revenue overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ error: "Failed to save finance revenue overrides", message: error instanceof Error ? error.message : "Failed to save finance revenue overrides" });
    }
  });

  app.delete("/api/finance/revenue/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
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

  // Finance COS Overrides API
  app.get("/api/finance/cos/overrides", async (req, res) => {
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

  app.post("/api/finance/cos/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { overrides } = req.body;
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ error: "Overrides must be an array", message: "Overrides must be an array" });
      }
      const userId = req.user?.id;
      const overridesWithUser = overrides.map(o => ({ ...o, createdBy: userId }));
      const saved = await storage.upsertManyFinanceCosOverrides(overridesWithUser);
      res.json({ message: "Finance COS overrides saved", count: saved.length, overrides: saved });
    } catch (error) {
      res.status(500).json({ error: "Failed to save finance COS overrides", message: error instanceof Error ? error.message : "Failed to save finance COS overrides" });
    }
  });

  app.delete("/api/finance/cos/overrides/:projectName", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/finance/revenue", async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let data;
      
      if (projectName && typeof projectName === 'string') {
        data = await storage.getFinanceRevenueMonthlyByProject(projectName);
        
        // Apply overrides if requested
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

  app.get("/api/finance/cos", async (req, res) => {
    try {
      const { projectName, startDate, endDate, applyOverrides } = req.query;
      let data;
      
      if (projectName && typeof projectName === 'string') {
        data = await storage.getFinanceCosMonthlyByProject(projectName);
        
        // Apply overrides if requested
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

  // ==================== REFRESH ROUTE ====================

  app.post("/api/refresh", requireAuth, requireAdmin, async (req, res) => {
    try {
      const refreshLog = await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: "success"
      });
      res.json({ message: "Data refresh recorded", refreshedAt: refreshLog.refreshedAt });
    } catch (error) {
      res.status(500).json({ error: "Failed to record refresh", message: "Failed to record refresh", code: "REFRESH_ERROR" });
    }
  });

  app.get("/api/refresh/latest", async (req, res) => {
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
          const projectName = upload.fileName.replace(/_Tracker\.(xlsx|xlsm|xls)$/i, '').replace(/^\d+_/, '');
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
            const parseResult = parseTrackerFile(fileBuffer, fileInfo.fileName);
            await applyFontColors(parseResult.expenses, fileBuffer);
            await storage.transaction(async (txStorage) => {
              await txStorage.deleteProgramExpensesByProject(parseResult.projectName);
              await txStorage.deleteProgramInflowsByProject(parseResult.projectName);
              await txStorage.deleteProjectPlansByProject(parseResult.projectName);
              await txStorage.deleteCashflowPointsByProject(parseResult.projectName);
              await txStorage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
              await txStorage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
              if (parseResult.projectInfo) await txStorage.upsertProjectInfo(parseResult.projectInfo);
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
        const projectName = upload.fileName.replace(/_Tracker\.(xlsx|xlsm|xls)$/i, '').replace(/^\d+_/, '');
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
          const parseResult = parseTrackerFile(fileBuffer, fileInfo.fileName);
          await applyFontColors(parseResult.expenses, fileBuffer);
          await storage.transaction(async (txStorage) => {
            await txStorage.deleteProgramExpensesByProject(parseResult.projectName);
            await txStorage.deleteProgramInflowsByProject(parseResult.projectName);
            await txStorage.deleteProjectPlansByProject(parseResult.projectName);
            await txStorage.deleteCashflowPointsByProject(parseResult.projectName);
            await txStorage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
            await txStorage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
            if (parseResult.projectInfo) await txStorage.upsertProjectInfo(parseResult.projectInfo);
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
  app.post("/api/admin/clear-all-data", requireAuth, requireAdmin, async (req, res) => {
    const startTime = Date.now();
    
    try {
      const result = await storage.clearAllData();
      
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
  app.get("/api/admin/folder-config", async (req, res) => {
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
      res.status(500).json({ error: "Failed to read folder config", message: error.message });
    }
  });

  app.post("/api/admin/folder-config", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { folderPath } = req.body;
      if (!folderPath) {
        return res.status(400).json({ error: "folderPath required" });
      }
      
      const resolvedPath = path.resolve(folderPath);
      const exists = fs.existsSync(resolvedPath);
      
      if (!exists) {
        return res.status(400).json({ error: "Folder does not exist", path: resolvedPath });
      }
      
      process.env.TRACKER_FOLDER_PATH = resolvedPath;
      
      const files = fs.readdirSync(resolvedPath).filter(f => /\.(xlsx|xlsm|xls)$/i.test(f));
      
      res.json({ 
        success: true, 
        folderPath: resolvedPath, 
        fileCount: files.length,
        message: `Folder set to ${resolvedPath} (${files.length} Excel files found)` 
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to set folder", message: error.message });
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
          const parseResult = parseTrackerFile(fileBuffer, fileName);
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
      res.json({ success: true, projectCounts: counts });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to mark projects active", message: error.message });
    }
  });

  // Get refresh history
  app.get("/api/admin/refresh-history", async (req, res) => {
    try {
      const uploads = await storage.getAllUploads();
      const latest = await storage.getLatestRefresh();
      
      // Get unique source files
      const sourceFiles = new Map<string, { fileName: string; filePath: string; exists: boolean; uploadedAt: string }>();
      for (const upload of uploads) {
        if (!upload.filePath) continue;
        const projectName = upload.fileName.replace(/_Tracker\.(xlsx|xlsm|xls)$/i, '').replace(/^\d+_/, '');
        
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

  app.get("/api/uploads", async (req, res) => {
    try {
      const uploads = await storage.getAllUploads();
      res.json(uploads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch upload history", message: "Failed to fetch upload history" });
    }
  });

  // ==================== CSV EXPORT ROUTES ====================

  app.get("/api/export/projects", async (req, res) => {
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

  app.get("/api/export/expenses", async (req, res) => {
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

  app.get("/api/export/revenues", async (req, res) => {
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

  app.get("/api/export/tasks", async (req, res) => {
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

  app.get("/api/export/projects-summary", async (req, res) => {
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
  
  app.get("/api/admin/smoke-test", async (req, res) => {
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

      // 3. Upload baseline test - Check existing uploads
      try {
        const uploadDir = path.join(process.cwd(), 'uploads');
        const files = fs.readdirSync(uploadDir).filter(f => 
          f.endsWith('.xlsx') || f.endsWith('.xlsm') || f.endsWith('.xls')
        );
        
        addCheck("upload_files_available", files.length > 0, {
          count: files.length,
          files: files.slice(0, 5)
        });
      } catch (err: any) {
        addCheck("upload_files_available", false, { error: err.message });
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

      // 6. Revenue data check (program_inflows)
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

      // 7. COS data check (program_expenses)
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
  app.get("/api/projects/:projectName/working-plan", async (req, res) => {
    try {
      const { projectName } = req.params;
      const decodedName = decodeURIComponent(projectName);

      // Get or create active scenario
      const scenario = await storage.getOrCreateActiveScenario(decodedName);

      // Get base tasks from project_plan
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
      const { projectName, startDate, endDate, name, taskNo, comment } = req.body;

      if (!projectName) {
        return res.status(400).json({ error: "validation_error", message: "projectName is required" });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);
      const id = parseInt(taskId);

      // Check if override already exists for this task
      const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
      const existing = existingOverrides.find(o => o.importedTaskId === id);

      if (existing) {
        // Update existing override
        const updated = await storage.updateTaskOverride(existing.id, {
          overrideStartDate: startDate || existing.overrideStartDate,
          overrideEndDate: endDate || existing.overrideEndDate,
          overrideName: name || existing.overrideName,
          overrideTaskNo: taskNo || existing.overrideTaskNo,
          overrideComment: comment || existing.overrideComment,
        });
        res.json(updated);
      } else {
        // Create new override
        const created = await storage.createTaskOverride({
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
        res.json(created);
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

      res.json(created);
    } catch (error: any) {
      console.error("Error creating task:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Delete task from working plan (soft delete)
  app.delete("/api/working-plan/tasks/:taskId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { taskId } = req.params;
      const { projectName, isNewTask } = req.body;

      if (!projectName) {
        return res.status(400).json({ error: "validation_error", message: "projectName is required" });
      }

      const scenario = await storage.getOrCreateActiveScenario(projectName);
      const id = parseInt(taskId);

      if (isNewTask) {
        // For new tasks, we can hard delete the override
        await storage.softDeleteTaskOverride(Math.abs(id));
      } else {
        // For imported tasks, create soft-delete override
        const existingOverrides = await storage.getTaskOverridesByScenario(scenario.id);
        const existing = existingOverrides.find(o => o.importedTaskId === id);

        if (existing) {
          await storage.softDeleteTaskOverride(existing.id);
        } else {
          await storage.createTaskOverride({
            scenarioId: scenario.id,
            importedTaskId: id,
            overrideStartDate: null,
            overrideEndDate: null,
            overrideName: null,
            overrideTaskNo: null,
            overrideComment: null,
            deletedFlag: 1,
            isNewTask: 0,
          });
        }
      }

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

      res.json(created);
    } catch (error: any) {
      console.error("Error creating dependency:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Delete dependency
  app.delete("/api/dependencies/:depId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { depId } = req.params;
      await storage.deleteDependency(parseInt(depId));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting dependency:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Get schedule change notices
  app.get("/api/projects/:projectName/change-notices", async (req, res) => {
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

      res.json(created);
    } catch (error: any) {
      console.error("Error creating change notice:", error);
      res.status(500).json({ error: "server_error", message: error.message });
    }
  });

  // Update schedule change notice (mark as notified/documented)
  app.patch("/api/change-notices/:noticeId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { noticeId } = req.params;
      const { clientNotified, documentationUpdated, userNote } = req.body;

      const updated = await storage.updateChangeNotice(parseInt(noticeId), {
        clientNotified: clientNotified !== undefined ? clientNotified : undefined,
        documentationUpdated: documentationUpdated !== undefined ? documentationUpdated : undefined,
        userNote: userNote !== undefined ? userNote : undefined,
      });

      if (!updated) {
        return res.status(404).json({ error: "not_found", message: "Change notice not found" });
      }

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
      const expenses = await db.select().from(programExpense);
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

      const expenses = await db.select().from(programExpense);
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
      let expenses = await db.select().from(programExpense);

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

      const expenses = await db.select().from(programExpense);
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
      const expenses = await db.select().from(programExpense);
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

      const [expenses, rawInflows, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        db.select().from(programExpense),
        db.select().from(programInflows),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);

      const resolvedInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

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

      const [expenses, rawInflows, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        db.select().from(programExpense),
        db.select().from(programInflows),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);

      const resolvedInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

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

      const expenses = await db.select().from(programExpense);
      const inflows = await db.select().from(programInflows);
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
      const expenses = await db.select().from(programExpense);
      const inflows = await db.select().from(programInflows);

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
        if (totalActual > totalBudget * 1.1 && totalBudget > 0) riskFlags.push('Over budget');
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
      res.json(dup);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/scenarios/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteScenario(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scenarios/:id/reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.clearDateOverrides(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/scenarios/:id/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const overrides = await storage.getDateOverridesByScenario(id);
      res.json({ overrides });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scenarios/:id/overrides", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { entityType, entityId, fieldName, originalDate, overrideDate, reason } = req.body;
      if (!entityType || !entityId || !fieldName || !overrideDate || !reason) {
        return res.status(400).json({ error: "entityType, entityId, fieldName, overrideDate, and reason are required" });
      }
      const userId = (req.user as any)?.id;
      const override = await storage.createDateOverride({
        scenarioId: id, entityType, entityId, fieldName, originalDate, overrideDate, reason, createdBy: userId,
      });
      res.json(override);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/overrides/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDateOverride(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ SCENARIO-AWARE COS CONTROL API ============

  app.get("/api/cos-control/scenario-monthly", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const allExpenses = await db.select().from(programExpense);
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      const cosLines: any[] = items.map((e: any) => ({
        id: e.id,
        projectName: e.projectName,
        expenseCategory: e.expenseCategory,
        expenseLineItem: e.expenseLineItem,
        amount: Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0')),
        state: e.computedState || classifyExpenseState({
          poNumber: e.expensePoNumber, invoiceNumber: e.expenseInvoiceNumber,
          invoicedDate: e.expenseInvoicedDate, paymentDate: e.expensePaymentDate,
        }),
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
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        const overrideMap = buildOverrideMap(overrides);
        scenarioLines = applyOverridesToCOSLines(cosLines, overrideMap);
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

  app.get("/api/cos-control/scenario-invoices", requireAuth, requireAdmin, async (req, res) => {
    try {
      const scenarioId = req.query.scenarioId ? parseInt(req.query.scenarioId as string) : null;
      const search = (req.query.search as string || '').toLowerCase();
      const project = req.query.project as string || '';
      const state = req.query.state as string || '';

      const allExpenses = await db.select().from(programExpense);
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        overrideMap = buildOverrideMap(overrides);
      }

      const invoiceMap = new Map<string, any>();

      for (const e of items) {
        const amount = Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
        if (amount === 0) continue;

        const lineState = e.computedState || classifyExpenseState({
          poNumber: e.expensePoNumber, invoiceNumber: e.expenseInvoiceNumber,
          invoicedDate: e.expenseInvoicedDate, paymentDate: e.expensePaymentDate,
        });

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

      const allExpenses = await db.select().from(programExpense);
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        overrideMap = buildOverrideMap(overrides);
      }

      let lines = items.map((e: any) => {
        const amount = Math.abs(parseFloat(e.expenseActualTotal || e.budgetTotal || '0'));
        const lineState = e.computedState || classifyExpenseState({
          poNumber: e.expensePoNumber, invoiceNumber: e.expenseInvoiceNumber,
          invoicedDate: e.expenseInvoicedDate, paymentDate: e.expensePaymentDate,
        });

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

      const allExpenses = await db.select().from(programExpense);
      const items = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);
      const overrides = await storage.getDateOverridesByScenario(scenarioId);
      const overrideMap = buildOverrideMap(overrides);

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

      let allExpenses = await db.select().from(programExpense);
      const rawInflows = await db.select().from(programInflows);
      const [allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);

      let allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);

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
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        const overrideMap = buildOverrideMap(overrides);
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

      const [allExpenses, rawInflows, allTaskLinks, allOpTasks, allPlanTasks] = await Promise.all([
        db.select().from(programExpense),
        db.select().from(programInflows),
        storage.getAllMilestoneTaskLinks(),
        storage.getAllOperationalTasks(),
        storage.getAllProjectPlans(),
      ]);
      const allInflows = resolveInflowEffectiveDates(rawInflows, allTaskLinks, allOpTasks, allPlanTasks);
      const expenseItems = allExpenses.filter((e: any) => e.rowType === 'item' || !e.rowType);

      let overrideMap: any = {};
      if (scenarioId) {
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        overrideMap = buildOverrideMap(overrides);
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
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        overrideMap = buildOverrideMap(overrides);
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
        const overrides = await storage.getDateOverridesByScenario(scenarioId);
        overrideMap = buildOverrideMap(overrides);
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

      if (id < 0) {
        const planId = -id;
        let planTask: any = null;
        const allProjects = await storage.getAllProjectInfo();
        for (const proj of allProjects) {
          const plans = await storage.getProjectPlansByProject(proj.projectName);
          planTask = plans.find((t: any) => t.id === planId);
          if (planTask) break;
        }
        if (!planTask) return res.status(404).json({ error: "Baseline task not found" });

        const pctComplete = planTask.actualPctComplete != null ? Math.round(planTask.actualPctComplete * 100) : 0;
        let status = "Not Started";
        if (pctComplete >= 100) status = "Done";
        else if (pctComplete > 0) status = "In Progress";

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

      const task = await storage.getOperationalTask(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      const [comments, checklists, attachments, activity] = await Promise.all([
        storage.getTaskComments(id),
        storage.getTaskChecklists(id),
        storage.getTaskAttachments(id),
        storage.getTaskActivityLog(id),
      ]);
      const checklistsWithItems = await Promise.all(checklists.map(async cl => ({
        ...cl,
        items: await storage.getChecklistItems(cl.id),
      })));
      res.json({ task, comments, checklists: checklistsWithItems, attachments, activity });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/operational-tasks/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectName = req.params.projectName;
      const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";
      const [operationalTasks, planTasksDirect, planTasksTracker] = await Promise.all([
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
        projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
      ]);
      const planTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;

      const linkedImportedIds = new Set(
        operationalTasks
          .filter((t: any) => t.importedTaskId != null)
          .map((t: any) => t.importedTaskId)
      );

      const baselineTasks = planTasks
        .filter((pt: any) => !linkedImportedIds.has(pt.id))
        .map((pt: any) => {
          const pctComplete = pt.actualPctComplete != null ? Math.round(pt.actualPctComplete * 100) : 0;
          let status = "Not Started";
          if (pctComplete >= 100) status = "Done";
          else if (pctComplete > 0) status = "In Progress";

          return {
            id: -pt.id,
            projectName: pt.projectName,
            importedTaskId: pt.id,
            taskNumber: pt.taskNo || String(pt.rowNumber || ""),
            parentTaskId: null,
            title: pt.highLevelProgramme || `Task ${pt.taskNo || pt.rowNumber}`,
            description: null,
            status,
            priority: "Normal",
            startDate: pt.actualStart || null,
            dueDate: pt.actualEnd || null,
            durationDays: pt.durationDays || null,
            percentComplete: pctComplete,
            expectedPercentComplete: pt.expectedPctComplete != null ? Math.round(pt.expectedPctComplete * 100) : null,
            assignees: null,
            tags: null,
            blockerReason: null,
            plannedHours: null,
            actualHours: null,
            sortOrder: pt.rowNumber || 0,
            isBaseline: true,
            createdBy: null,
            createdAt: pt.createdAt,
            updatedAt: pt.createdAt,
          };
        });

      const merged = [...baselineTasks, ...operationalTasks];
      merged.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
      res.json(merged);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/operational-tasks", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const task = await storage.createOperationalTask(req.body);
      await storage.createTaskActivityLog({
        taskId: task.id,
        actorId: (req.user as any)?.id || null,
        actionType: 'created',
        fieldName: null,
        oldValue: null,
        newValue: null,
      });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/operational-tasks/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;

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
      if (!oldTask) return res.status(404).json({ error: "Task not found" });
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
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/operational-tasks/bulk-update", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { taskIds, updates } = req.body as { taskIds: number[]; updates: Record<string, any> };
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
      res.json(comment);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-comments/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskComment(parseInt(req.params.id));
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
      res.json(checklist);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-checklists/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskChecklist(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/task-checklist-items", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const item = await storage.createChecklistItem(req.body);
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/task-checklist-items/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const updated = await storage.updateChecklistItem(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-checklist-items/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteChecklistItem(parseInt(req.params.id));
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
      res.json(attachment);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/task-attachments/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskAttachment(parseInt(req.params.id));
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

  app.get("/api/planning-tasks/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";

      const [operationalTasks, planTasksDirect, planTasksTracker] = await Promise.all([
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
        projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
      ]);

      const planTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;

      const linkedImportedIds = new Set(
        operationalTasks
          .filter((t: any) => t.importedTaskId != null)
          .map((t: any) => t.importedTaskId)
      );

      const baselineTasks = planTasks
        .filter((pt: any) => !linkedImportedIds.has(pt.id))
        .map((pt: any) => {
          const pctComplete = pt.actualPctComplete != null ? Math.round(pt.actualPctComplete * 100) : 0;
          let status = "Not Started";
          if (pctComplete >= 100) status = "Done";
          else if (pctComplete > 0) status = "In Progress";

          return {
            id: -pt.id,
            projectName: projectName,
            importedTaskId: pt.id,
            taskNumber: pt.taskNo || String(pt.rowNumber || ""),
            parentTaskId: null as number | null,
            title: pt.highLevelProgramme || `Task ${pt.taskNo || pt.rowNumber}`,
            description: null,
            status,
            priority: "Normal",
            startDate: pt.actualStart || null,
            dueDate: pt.actualEnd || null,
            durationDays: pt.durationDays || null,
            percentComplete: pctComplete,
            expectedPercentComplete: pt.expectedPctComplete != null ? Math.round(pt.expectedPctComplete * 100) : null,
            assignees: null,
            tags: null,
            blockerReason: null,
            plannedHours: null,
            actualHours: null,
            actualStartDate: null as string | null,
            actualEndDate: null as string | null,
            actualDurationDays: null as number | null,
            comment: null as string | null,
            sortOrder: pt.rowNumber || 0,
            isBaseline: true,
            createdBy: null,
            createdAt: pt.createdAt,
            updatedAt: pt.createdAt,
          };
        });

      const allTasks: any[] = [...baselineTasks, ...operationalTasks];

      const taskNumToId = new Map<string, number>();
      for (const t of allTasks) {
        if (t.taskNumber) taskNumToId.set(String(t.taskNumber), t.id);
      }
      for (const t of allTasks) {
        if (t.parentTaskId) continue;
        const num = String(t.taskNumber || "");
        if (!num || !num.includes(".")) continue;
        const parts = num.split(".");
        parts.pop();
        const parentNum = parts.join(".");
        const parentId = taskNumToId.get(parentNum);
        if (parentId !== undefined) t.parentTaskId = parentId;
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

      const calcExpected = (t: any): number | null => {
        if (t.expectedPercentComplete != null) return t.expectedPercentComplete;
        const plannedStart = t.startDate ? new Date(t.startDate) : null;
        const plannedEnd = t.dueDate ? new Date(t.dueDate) : null;
        if (!plannedStart || !plannedEnd || isNaN(plannedStart.getTime()) || isNaN(plannedEnd.getTime())) return null;
        const startMs = plannedStart.getTime();
        const endMs = plannedEnd.getTime();
        if (todayMs < startMs) return 0;
        if (todayMs >= endMs) return 100;
        const totalDays = Math.max(1, (endMs - startMs) / 86400000);
        const elapsed = (todayMs - startMs) / 86400000;
        return Math.round((elapsed / totalDays) * 100);
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

        if (!parent.isBaseline) {
          parent.percentComplete = totalWeight > 0 ? Math.round(totalWeightedPct / totalWeight) : 0;
        }
        parent.computedExpectedPct = totalWeight > 0 ? Math.round(totalWeightedExpected / totalWeight) : calcExpected(parent);
        parent.isParent = true;
        parent.childCount = children.length;
      };

      const rootIds = allTasks.filter(t => !t.parentTaskId).map(t => t.id);
      for (const rootId of rootIds) computeRollups(rootId);

      for (const [, t] of taskMap) {
        if (!childrenMap.has(t.id)) {
          t.computedExpectedPct = calcExpected(t);
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
      res.json(result);
    } catch (err: any) {
      console.error("Planning tasks error:", err);
      res.status(500).json({ error: err.message });
    }
  });

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
      res.json(mapping);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const updated = await storage.updateKeyDateMapping(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/key-date-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteKeyDateMapping(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/key-dates/:projectName", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName);
      const trackerName = projectName.endsWith("_Tracker") ? projectName : projectName + "_Tracker";

      const [mappings, operationalTasks, planTasksDirect, planTasksTracker] = await Promise.all([
        storage.getKeyDateMappings(projectName),
        storage.getOperationalTasksByProject(projectName),
        storage.getProjectPlansByProject(projectName),
        projectName !== trackerName ? storage.getProjectPlansByProject(trackerName) : Promise.resolve([]),
      ]);

      const planTasks = planTasksDirect.length > 0 ? planTasksDirect : planTasksTracker;
      const baselineTasks = planTasks.map((pt: any) => ({
        id: -pt.id,
        taskNumber: pt.taskNo || String(pt.rowNumber || ""),
        title: pt.highLevelProgramme || `Task ${pt.taskNo || pt.rowNumber}`,
        startDate: pt.actualStart || null,
        dueDate: pt.actualEnd || null,
        actualStartDate: null,
        actualEndDate: null,
      }));
      const tasks: any[] = [...baselineTasks, ...operationalTasks];

      const results = mappings.map(m => {
        let matchedTask: any = null;
        if (m.sourceTaskId) {
          matchedTask = tasks.find((t: any) => t.id === m.sourceTaskId);
        } else if (m.sourceTaskCode) {
          matchedTask = tasks.find((t: any) => t.taskNumber === m.sourceTaskCode);
        } else if (m.sourceTaskNameMatch) {
          const pattern = m.sourceTaskNameMatch.toLowerCase();
          matchedTask = tasks.find((t: any) => t.title?.toLowerCase().includes(pattern));
        }

        let plannedDate: string | null = null;
        let actualDate: string | null = null;
        let effectiveDate: string | null = null;

        if (matchedTask) {
          plannedDate = m.dateField === 'startDate' ? matchedTask.startDate : matchedTask.dueDate;
          actualDate = m.dateField === 'startDate' ? matchedTask.actualStartDate : matchedTask.actualEndDate;
          if (m.precedenceRule === 'actual_over_planned') {
            effectiveDate = actualDate || plannedDate;
          } else {
            effectiveDate = plannedDate;
          }
        }

        return {
          id: m.id,
          keyDateName: m.keyDateName,
          sourceTaskId: m.sourceTaskId,
          sourceTaskCode: m.sourceTaskCode,
          sourceTaskNameMatch: m.sourceTaskNameMatch,
          dateField: m.dateField,
          precedenceRule: m.precedenceRule,
          sortOrder: m.sortOrder,
          matchedTaskId: matchedTask?.id || null,
          matchedTaskTitle: matchedTask?.title || null,
          matchedTaskNumber: matchedTask?.taskNumber || null,
          plannedDate,
          actualDate,
          effectiveDate,
          mappingValid: !!matchedTask,
        };
      });

      res.json(results);
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
      res.json(mapping);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const updated = await storage.updateWritebackMapping(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteWritebackMapping(parseInt(req.params.id));
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
      const sheets = getWorkbookSheets(check.resolved);
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
      const preview = previewWriteback(check.resolved, mappings, dataByEntity);
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
      const writeResult = writeToWorkbook(check.resolved, writes, resolvedOutputPath);

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
      const result = writeToWorkbook(rollbackCheck.resolved, [{
        sheetName: auditEntry.sheetName,
        cellAddress: auditEntry.cellAddress,
        value: auditEntry.previousValue,
      }]);

      if (result.success) {
        await storage.updateWritebackAuditLog(auditId, { rolledBackAt: new Date() });
      }

      res.json({ success: result.success, error: result.error });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
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
