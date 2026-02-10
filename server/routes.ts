import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import multer from "multer";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { parseTrackerFile } from "./excelParser";
import { insertBudgetSchema } from "@shared/schema";
import { z } from "zod";
import { format } from "date-fns";
import { generateToken, verifyToken } from "./jwt";
import { calculateCPM, applyOverridesToTasks, applyOverridesToDependencies, type CPMDependency } from "./cpmEngine";

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
  if (req.isAuthenticated() && req.user?.role === "admin") {
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
      const [allProjectInfo, allExpenses, allInflows, allPlans, latestRefresh] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getLatestRefresh()
      ]);

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

      // revenue_realised = SUM(milestone_amount where payment_received_date is valid YYYY-MM-DD and <= today)
      let revenueRealised = 0;
      for (const inflow of allInflows) {
        const paymentDate = inflow.paymentReceivedDate;
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
      const [allProjectInfo, allExpenses, allInflows, allPlans, latestRefresh, revenueSummaries] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getLatestRefresh(),
        storage.getAllProjectRevenueSummaries()
      ]);

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

      // Upcoming events (next 10 days)
      const constructionStartSoon = allProjectInfo.filter(p => isWithinDays(p.constructionStartDate, 10)).length;
      const commissioningSoon = allProjectInfo.filter(p => isWithinDays(p.commissioningDate, 10)).length;
      const omHandoverSoon = allProjectInfo.filter(p => isWithinDays(p.omHandoverDate, 10)).length;
      const clientHandoverSoon = allProjectInfo.filter(p => isWithinDays(p.clientHandoverDate, 10)).length;

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

      // This week cashflows
      let weeklyInflows = 0, weeklyOutflows = 0;
      for (const inf of allInflows) {
        if (isThisWeek(inf.paymentReceivedDate) && inf.milestoneAmount) {
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

  app.post("/api/home/notes", async (req, res) => {
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
        const category = exp.expenseCategory || 'Uncategorized';

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
      const [allProjectInfo, allExpenses, allInflows, allPlans, allEditableFields] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getAllProjectEditableFields()
      ]);

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
  app.post("/api/projects-summary/:projectName/edit", requireAuth, async (req, res) => {
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

  app.get("/api/cashflow-2026", requireAuth, async (req, res) => {
    try {
      const projectFilter = req.query.project ? String(req.query.project) : null;

      const [allExpenses, allInflows, manualBalances, opexBudgets] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllCashflowWeeklyManual(),
        storage.getAllOpexBudgetMonthly(),
      ]);

      const manualMap = new Map(manualBalances.map(m => [m.weekStartDate, parseFloat(m.openingBalance || "0")]));
      const opexMap = new Map(opexBudgets.map(o => [o.monthKey, parseFloat(o.amount || "0")]));

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

      while (cursor <= fyEnd) {
        const weekStart = cursor.toISOString().split('T')[0];
        const weekEndDate = new Date(cursor);
        weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
        const weekEnd = weekEndDate.toISOString().split('T')[0];

        let projectInflowsSum = 0;
        for (const inflow of allInflows) {
          if (projectFilter && inflow.projectName !== projectFilter) continue;
          const d = inflow.paymentReceivedDate;
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

        const openingBalance = manualMap.get(weekStart) || 0;

        const mk = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
        const monthlyOpex = opexMap.get(mk) || 0;
        const weeksCount = weeksInMonth.get(mk) || 1;
        const opexOutflows = monthlyOpex / weeksCount;

        const closingBalance = openingBalance + projectInflowsSum - opexOutflows - projectOutflowsSum;
        const availablePayment = openingBalance + projectInflowsSum;

        weeks.push({
          weekStart,
          weekEnd,
          projectInflows: projectInflowsSum,
          projectOutflows: projectOutflowsSum,
          openingBalance,
          opexOutflows,
          closingBalance,
          availablePayment,
        });

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

      const [allExpenses, allInflows] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
      ]);

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

      const inflows = allInflows
        .filter(inf => {
          if (projectFilter && inf.projectName !== projectFilter) return false;
          const pd = inf.paymentReceivedDate;
          if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return false;
          return pd >= weekStart && pd < weekEnd;
        })
        .map(inf => {
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
            paymentReceivedDate: inf.paymentReceivedDate,
            milestoneAmount: inf.milestoneAmount ? parseFloat(inf.milestoneAmount) : 0,
            invoiceRaisedDate: inf.invoiceRaisedDate,
            daysToReceipt,
          };
        });

      res.json({ outflows, inflows });
    } catch (error) {
      console.error("Cashflow 2026 detail error:", error);
      res.status(500).json({ error: "Failed to fetch cashflow detail", message: "Failed to fetch cashflow detail" });
    }
  });

  // ==================== MANUAL INPUT ENDPOINTS ====================

  app.post("/api/cashflow-2026/opening-balance", requireAuth, async (req, res) => {
    try {
      const { weekStartDate, openingBalance } = req.body;
      if (!weekStartDate || openingBalance == null) {
        return res.status(400).json({ error: "weekStartDate and openingBalance required" });
      }
      const result = await storage.upsertCashflowWeeklyManual(weekStartDate, String(openingBalance));
      res.json(result);
    } catch (error) {
      console.error("Opening balance save error:", error);
      res.status(500).json({ error: "Failed to save opening balance", message: "Failed to save opening balance" });
    }
  });

  app.post("/api/cashflow-2026/opex-budget", requireAuth, async (req, res) => {
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

  app.get("/api/cashflow-2026/opex-budget", requireAuth, async (req, res) => {
    try {
      const entries = await storage.getAllOpexBudgetMonthly();
      res.json(entries);
    } catch (error) {
      console.error("OPEX budget fetch error:", error);
      res.status(500).json({ error: "Failed to fetch OPEX budgets", message: "Failed to fetch OPEX budgets" });
    }
  });

  app.post("/api/tracker-monthly", requireAuth, async (req, res) => {
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

  app.get("/api/tracker-monthly/:type", requireAuth, async (req, res) => {
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

  app.get("/api/rev-tracker", requireAuth, async (req, res) => {
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

  app.get("/api/cos-tracker", requireAuth, async (req, res) => {
    try {
      const [allExpenses, manualEntries] = await Promise.all([
        storage.getAllProgramExpenses(),
        storage.getTrackerMonthlyManual('COS'),
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
        for (const expense of allExpenses) {
          if (!expense.expenseInvoiceNumber || !expense.expenseInvoicedDate) continue;
          const d = expense.expenseInvoicedDate;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (d >= monthStart && d < monthEnd && expense.expenseActualTotal) {
            planned += parseFloat(expense.expenseActualTotal);
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
      console.error("COS tracker error:", error);
      res.status(500).json({ error: "Failed to fetch COS tracker data", message: "Failed to fetch COS tracker data" });
    }
  });

  // ==================== PROGRAM DASHBOARD API ====================

  app.get("/api/program-dashboard", requireAuth, async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, allInflows, allPlans, allEditableFields] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans(),
        storage.getAllProjectEditableFields(),
      ]);

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

        if (isWithinDays(constructionStartDate, 10)) siteEstablishmentNext10++;
        if (isWithinDays(commissioningDate, 10)) commissioningNext10++;
        if (isWithinDays(omHandoverDate, 10)) omHandoverNext10++;
        if (isWithinDays(clientHandoverDate, 10)) clientHandoverNext10++;

        for (const inflow of projectInflows) {
          if (inflow.milestoneAmount) {
            const hasPayment = inflow.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}$/.test(inflow.paymentReceivedDate) && inflow.paymentReceivedDate <= today;
            const noInvoice = !inflow.milestoneInvoiceNumber || inflow.milestoneInvoiceNumber.trim() === '';
            if (hasPayment && noInvoice) {
              revenueOutstanding += parseFloat(inflow.milestoneAmount);
            }
          }
          if (isThisWeek(inflow.paymentReceivedDate) && inflow.milestoneAmount) {
            inflowsThisWeek += parseFloat(inflow.milestoneAmount);
          }
        }

        for (const expense of projectExpenses) {
          if (expense.expenseActualTotal) {
            const hasPastPaymentDate = expense.expensePaymentDate && /^\d{4}-\d{2}-\d{2}$/.test(expense.expensePaymentDate) && expense.expensePaymentDate < today;
            const noInvoice = !expense.expenseInvoiceNumber || expense.expenseInvoiceNumber.trim() === '';
            if (hasPastPaymentDate && noInvoice) {
              expenseOverdue += parseFloat(expense.expenseActualTotal);
            }
          }
          if (isThisWeek(expense.expensePaymentDate) && expense.expenseActualTotal) {
            outflowsThisWeek += parseFloat(expense.expenseActualTotal);
          }
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
        pmTable,
      });
    } catch (error) {
      console.error("Program dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch program dashboard", message: "Failed to fetch program dashboard" });
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

  app.post("/api/budgets", async (req, res) => {
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

  app.delete("/api/budgets/:id", async (req, res) => {
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

  app.post("/api/upload", multiUpload, async (req, res) => {
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

  app.post("/api/reprocess-all", async (req, res) => {
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

  app.post("/api/cashflow/planning-overrides", async (req, res) => {
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

  app.delete("/api/cashflow/planning-overrides/:projectName", async (req, res) => {
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

  app.post("/api/project-plan/overrides", async (req, res) => {
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

  app.delete("/api/project-plan/overrides/:projectName", async (req, res) => {
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

  app.post("/api/revenue-tracking/overrides", async (req, res) => {
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

  app.delete("/api/revenue-tracking/overrides/:projectName", async (req, res) => {
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

  app.post("/api/expenditure/overrides", async (req, res) => {
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

  app.delete("/api/expenditure/overrides/:projectName", async (req, res) => {
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

  app.post("/api/finance/revenue/overrides", async (req, res) => {
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

  app.delete("/api/finance/revenue/overrides/:projectName", async (req, res) => {
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

  app.post("/api/finance/cos/overrides", async (req, res) => {
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

  app.delete("/api/finance/cos/overrides/:projectName", async (req, res) => {
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

  app.post("/api/refresh", async (req, res) => {
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
  app.post("/api/admin/refresh-data", async (req, res) => {
    const startTime = Date.now();
    
    try {
      // Get all uploads with file paths
      const uploads = await storage.getAllUploads();
      const refreshResults: { 
        fileName: string; 
        projectName: string;
        status: string; 
        message?: string;
        recordsProcessed?: number;
      }[] = [];
      
      // Group by project (use most recent upload per project)
      const projectFiles = new Map<string, { filePath: string; fileName: string; uploadedAt: Date }>();
      for (const upload of uploads) {
        if (!upload.filePath) continue;
        
        // Extract project name from filename
        const projectName = upload.fileName.replace(/_Tracker\.(xlsx|xlsm|xls)$/i, '').replace(/^\d+_/, '');
        
        // Keep the most recent file for each project
        const existing = projectFiles.get(projectName);
        if (!existing || (upload.uploadedAt && existing.uploadedAt < upload.uploadedAt)) {
          projectFiles.set(projectName, { 
            filePath: upload.filePath, 
            fileName: upload.fileName,
            uploadedAt: upload.uploadedAt || new Date(0)
          });
        }
      }
      
      // Reprocess each project's latest file in transaction
      for (const [projectName, fileInfo] of Array.from(projectFiles.entries())) {
        try {
          if (!fs.existsSync(fileInfo.filePath)) {
            refreshResults.push({
              fileName: fileInfo.fileName,
              projectName,
              status: "error",
              message: "Source file not found on disk"
            });
            continue;
          }
          
          const fileBuffer = fs.readFileSync(fileInfo.filePath);
          const parseResult = parseTrackerFile(fileBuffer, fileInfo.fileName);
          
          // Perform refresh in transaction
          await storage.transaction(async (txStorage) => {
            // Delete existing data for this project
            await txStorage.deleteProgramExpensesByProject(parseResult.projectName);
            await txStorage.deleteProgramInflowsByProject(parseResult.projectName);
            await txStorage.deleteProjectPlansByProject(parseResult.projectName);
            await txStorage.deleteCashflowPointsByProject(parseResult.projectName);
            await txStorage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
            await txStorage.deleteFinanceCosMonthlyByProject(parseResult.projectName);
            
            // Re-insert all data
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
          
          const recordsProcessed = parseResult.expensesParsed + parseResult.inflowsParsed + 
            parseResult.planParsed + parseResult.cashflowParsed + 
            parseResult.financeRevenueParsed + parseResult.financeCosParsed;
          
          refreshResults.push({
            fileName: fileInfo.fileName,
            projectName: parseResult.projectName,
            status: "success",
            message: `Refreshed from source`,
            recordsProcessed
          });
          
        } catch (error: any) {
          refreshResults.push({
            fileName: fileInfo.fileName,
            projectName,
            status: "error",
            message: error.message || "Refresh failed"
          });
        }
      }
      
      // Log the refresh
      await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: refreshResults.every(r => r.status === "success") ? "success" : "partial"
      });
      
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
  app.post("/api/admin/clear-all-data", async (req, res) => {
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
      
      res.json({ folderPath, exists, fileCount, latestFileDate });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to read folder config", message: error.message });
    }
  });

  app.post("/api/admin/folder-config", async (req, res) => {
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
  app.post("/api/admin/scan-folder", async (req, res) => {
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
  app.post("/api/projects/:projectName/working-plan/reset", async (req, res) => {
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
  app.patch("/api/working-plan/tasks/:taskId", async (req, res) => {
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
  app.post("/api/working-plan/tasks", async (req, res) => {
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
  app.delete("/api/working-plan/tasks/:taskId", async (req, res) => {
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
  app.post("/api/projects/:projectName/dependencies", async (req, res) => {
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
  app.delete("/api/dependencies/:depId", async (req, res) => {
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
  app.post("/api/projects/:projectName/change-notices", async (req, res) => {
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
  app.patch("/api/change-notices/:noticeId", async (req, res) => {
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
