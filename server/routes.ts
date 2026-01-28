import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import multer from "multer";
import { storage } from "./storage";
import { parseTrackerFile } from "./excelParser";
import { insertBudgetSchema } from "@shared/schema";
import { z } from "zod";
import { format } from "date-fns";
import { generateToken, verifyToken } from "./jwt";

const upload = multer({ 
  storage: multer.memoryStorage(),
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
  
  res.status(401).json({ error: "Authentication required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated() && req.user?.role === "admin") {
    return next();
  }
  res.status(403).json({ message: "Admin access required" });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== HEALTH CHECK ====================
  
  app.get("/api/health", async (req, res) => {
    const { dbMode, dbConfig } = await import("./db");
    const { getDbConfigStatus } = await import("./db-config");
    
    const dbStatus = getDbConfigStatus();
    
    res.json({
      status: 'ok',
      database: {
        mode: dbMode,
        connected: dbStatus.connected,
        message: dbStatus.message,
      },
      timestamp: new Date().toISOString(),
    });
  });
  
  // ==================== AUTH ROUTES ====================
  
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: { message: string }) => {
      if (err) {
        console.error("Login error:", err);
        
        // Provide better error messages for common DB connection issues
        if (err.message && (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED'))) {
          return res.status(503).json({ 
            message: "Database connection unavailable. Please check the database configuration.",
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
          });
        }
        
        return res.status(500).json({ 
          message: "An error occurred during login",
          details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
      }
      
      if (!user) {
        return res.status(401).json({ message: info?.message || "Login failed" });
      }
      
      req.logIn(user, (err) => {
        if (err) {
          console.error("Session error:", err);
          return res.status(500).json({ 
            message: "Failed to establish session",
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
          });
        }
        
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
        return res.status(500).json({ message: "Logout failed" });
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
    
    res.status(401).json({ message: "Not authenticated" });
  });

  app.get("/api/auth/status", (req, res) => {
    const hasCookie = !!req.headers.cookie;
    const hasSession = !!req.session;
    const hasUser = !!req.user;
    const isAuthenticated = req.isAuthenticated();
    const authHeader = req.headers.authorization;
    const hasAuthHeader = !!authHeader;
    
    let jwtValid = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      jwtValid = !!payload;
    }
    
    res.json({
      authenticated: isAuthenticated || jwtValid,
      hasSession: hasSession,
      hasUser: hasUser,
      hasCookie: hasCookie,
      hasAuthHeader: hasAuthHeader,
      jwtValid: jwtValid,
      sessionAuth: isAuthenticated,
    });
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
      res.status(500).json({ message: "Failed to fetch overview data" });
    }
  });

  // ==================== PROJECTS SUMMARY API ====================

  app.get("/api/projects-summary", async (req, res) => {
    try {
      const [allProjectInfo, allExpenses, allInflows, allPlans] = await Promise.all([
        storage.getAllProjectInfo(),
        storage.getAllProgramExpenses(),
        storage.getAllProgramInflows(),
        storage.getAllProjectPlans()
      ]);

      const today = new Date().toISOString().split("T")[0];

      // Group data by project name
      const expensesByProject = new Map<string, typeof allExpenses>();
      for (const expense of allExpenses) {
        if (!expensesByProject.has(expense.projectName)) {
          expensesByProject.set(expense.projectName, []);
        }
        expensesByProject.get(expense.projectName)!.push(expense);
      }

      const inflowsByProject = new Map<string, typeof allInflows>();
      for (const inflow of allInflows) {
        if (!inflowsByProject.has(inflow.projectName)) {
          inflowsByProject.set(inflow.projectName, []);
        }
        inflowsByProject.get(inflow.projectName)!.push(inflow);
      }

      const plansByProject = new Map<string, typeof allPlans>();
      for (const plan of allPlans) {
        if (!plansByProject.has(plan.projectName)) {
          plansByProject.set(plan.projectName, []);
        }
        plansByProject.get(plan.projectName)!.push(plan);
      }

      // Collect all unique project names from all data sources
      const allProjectNames = new Set<string>();
      for (const info of allProjectInfo) {
        allProjectNames.add(info.projectName);
      }
      for (const expense of allExpenses) {
        allProjectNames.add(expense.projectName);
      }
      for (const inflow of allInflows) {
        allProjectNames.add(inflow.projectName);
      }
      for (const plan of allPlans) {
        allProjectNames.add(plan.projectName);
      }

      // Create a lookup map for project info
      const projectInfoMap = new Map(allProjectInfo.map(info => [info.projectName, info]));

      const projectsSummary = Array.from(allProjectNames).map(projectName => {
        const info = projectInfoMap.get(projectName);
        const projectExpenses = expensesByProject.get(projectName) || [];
        const projectInflows = inflowsByProject.get(projectName) || [];
        const projectPlans = plansByProject.get(projectName) || [];

        // Calculate actual revenue = SUM(milestone_amount)
        let actualRevenue = 0;
        for (const inflow of projectInflows) {
          if (inflow.milestoneAmount) {
            actualRevenue += parseFloat(inflow.milestoneAmount);
          }
        }

        // Calculate actual expenses = SUM(expense_actual_total)
        let actualExpenses = 0;
        for (const expense of projectExpenses) {
          if (expense.expenseActualTotal) {
            actualExpenses += parseFloat(expense.expenseActualTotal);
          }
        }

        // GP % = 1 - (Actual Expenses / Actual Revenue)
        let gpPercent: number | null = null;
        if (actualRevenue > 0) {
          gpPercent = 1 - (actualExpenses / actualRevenue);
        }

        // Project % Complete = avg(actual_pct_complete)
        let projectPctComplete: number | null = null;
        let expectedPctComplete: number | null = null;
        const validActualPcts = projectPlans.filter(p => p.actualPctComplete !== null);
        const validExpectedPcts = projectPlans.filter(p => p.expectedPctComplete !== null);
        
        if (validActualPcts.length > 0) {
          projectPctComplete = validActualPcts.reduce((sum, p) => sum + (p.actualPctComplete || 0), 0) / validActualPcts.length;
        }
        if (validExpectedPcts.length > 0) {
          expectedPctComplete = validExpectedPcts.reduce((sum, p) => sum + (p.expectedPctComplete || 0), 0) / validExpectedPcts.length;
        }

        // Delta vs Expected
        let deltaVsExpected: number | null = null;
        if (projectPctComplete !== null && expectedPctComplete !== null) {
          deltaVsExpected = projectPctComplete - expectedPctComplete;
        }

        // Revenue Outstanding = SUM(inflows where payment_received_date is empty AND invoice_number is empty)
        let revenueOutstanding = 0;
        for (const inflow of projectInflows) {
          if (!inflow.paymentReceivedDate && !inflow.milestoneInvoiceNumber && inflow.milestoneAmount) {
            revenueOutstanding += parseFloat(inflow.milestoneAmount);
          }
        }

        // Expenses Outstanding = SUM(expenses where payment_date is empty AND invoice_number is empty)
        let expensesOutstanding = 0;
        for (const expense of projectExpenses) {
          if (!expense.expensePaymentDate && !expense.expenseInvoiceNumber && expense.expenseActualTotal) {
            expensesOutstanding += parseFloat(expense.expenseActualTotal);
          }
        }

        return {
          project_name: projectName,
          size_kwp: info?.sizeKwp ? parseFloat(info.sizeKwp) : null,
          pd: info?.pd || null,
          pm: info?.pm || null,
          cost_proposal_signed: null,
          funding_signed: null,
          epc_contract_signed: null,
          phase: info?.phase || null,
          pd_handover_date: null,
          construction_start_date: null,
          duration: null,
          kw_per_week: null,
          commissioning_date: null,
          om_handover_date: null,
          client_handover_date: null,
          project_pct_complete: projectPctComplete,
          expected_pct_complete: expectedPctComplete,
          delta_vs_expected: deltaVsExpected,
          actual_revenue: actualRevenue,
          actual_expenses: actualExpenses,
          gp_percent: gpPercent,
          revenue_outstanding: revenueOutstanding,
          expenses_outstanding: expensesOutstanding,
          current_vo_total: 0
        };
      });

      res.json(projectsSummary);
    } catch (error) {
      console.error("Projects summary fetch error:", error);
      res.status(500).json({ message: "Failed to fetch projects summary" });
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
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });

  // ==================== PROJECTS ROUTES ====================

  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project" });
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
      res.status(500).json({ message: "Failed to fetch expenses" });
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
      res.status(500).json({ message: "Failed to fetch revenues" });
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
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // ==================== BUDGETS ROUTES (Admin Only) ====================

  app.get("/api/budgets", async (req, res) => {
    try {
      const budgets = await storage.getAllBudgets();
      res.json(budgets);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch budgets" });
    }
  });

  app.post("/api/budgets", requireAuth, requireAdmin, async (req, res) => {
    try {
      const parsed = insertBudgetSchema.parse(req.body);
      const budget = await storage.createBudget(parsed);
      res.status(201).json(budget);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid budget data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create budget" });
    }
  });

  app.delete("/api/budgets/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteBudget(id);
      if (!deleted) {
        return res.status(404).json({ message: "Budget not found" });
      }
      res.json({ message: "Budget deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete budget" });
    }
  });

  // ==================== FILE UPLOAD ROUTE ====================

  app.post("/api/upload", requireAuth, upload.array("files", 20), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
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
        warnings?: string[];
      }[] = [];

      for (const file of files) {
        try {
          const parseResult = parseTrackerFile(file.buffer, file.originalname);
          
          // Delete existing data for this project before inserting new
          await storage.deleteProgramExpensesByProject(parseResult.projectName);
          await storage.deleteProgramInflowsByProject(parseResult.projectName);
          await storage.deleteProjectPlansByProject(parseResult.projectName);

          // Insert project info
          if (parseResult.projectInfo) {
            await storage.upsertProjectInfo(parseResult.projectInfo);
          }

          // Insert expenses
          if (parseResult.expenses.length > 0) {
            await storage.createManyProgramExpenses(parseResult.expenses);
          }

          // Insert inflows
          if (parseResult.inflows.length > 0) {
            await storage.createManyProgramInflows(parseResult.inflows);
          }

          // Insert plan items
          if (parseResult.planItems.length > 0) {
            await storage.createManyProjectPlans(parseResult.planItems);
          }

          await storage.createUpload({
            fileName: file.originalname,
            uploadedBy: req.user?.id || null,
            recordsProcessed: parseResult.expensesParsed + parseResult.inflowsParsed + parseResult.planParsed,
            validationErrors: parseResult.warnings.length > 0 ? parseResult.warnings.join("; ") : null,
            status: "success"
          });

          results.push({
            file: file.originalname,
            status: "success",
            project_name: parseResult.projectName,
            expensesParsed: parseResult.expensesParsed,
            inflowsParsed: parseResult.inflowsParsed,
            planParsed: parseResult.planParsed,
            infoParsed: parseResult.infoParsed,
            warnings: parseResult.warnings
          });

        } catch (fileError: any) {
          console.error("File parse error:", fileError);
          results.push({
            file: file.originalname,
            status: "error",
            message: fileError.message || "Failed to process file"
          });

          await storage.createUpload({
            fileName: file.originalname,
            uploadedBy: req.user?.id || null,
            recordsProcessed: 0,
            validationErrors: fileError.message,
            status: "error"
          });
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
      res.status(500).json({ message: error.message || "Failed to process upload" });
    }
  });

  // ==================== PROGRAM DATA ROUTES ====================

  app.get("/api/program-expenses", async (req, res) => {
    try {
      const { projectName } = req.query;
      if (projectName && typeof projectName === 'string') {
        const expenses = await storage.getProgramExpensesByProject(projectName);
        return res.json(expenses);
      }
      const expenses = await storage.getAllProgramExpenses();
      res.json(expenses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch program expenses" });
    }
  });

  app.get("/api/program-inflows", async (req, res) => {
    try {
      const { projectName } = req.query;
      if (projectName && typeof projectName === 'string') {
        const inflows = await storage.getProgramInflowsByProject(projectName);
        return res.json(inflows);
      }
      const inflows = await storage.getAllProgramInflows();
      res.json(inflows);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch program inflows" });
    }
  });

  app.get("/api/project-plans", async (req, res) => {
    try {
      const { projectName } = req.query;
      if (projectName && typeof projectName === 'string') {
        const plans = await storage.getProjectPlansByProject(projectName);
        return res.json(plans);
      }
      const plans = await storage.getAllProjectPlans();
      res.json(plans);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project plans" });
    }
  });

  app.get("/api/project-info", async (req, res) => {
    try {
      const info = await storage.getAllProjectInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project info" });
    }
  });

  // ==================== REFRESH ROUTE ====================

  app.post("/api/refresh", requireAuth, async (req, res) => {
    try {
      const refreshLog = await storage.createRefreshLog({
        triggeredBy: req.user?.id || null,
        status: "success"
      });
      res.json({ message: "Data refresh recorded", refreshedAt: refreshLog.refreshedAt });
    } catch (error) {
      res.status(500).json({ message: "Failed to record refresh" });
    }
  });

  app.get("/api/refresh/latest", async (req, res) => {
    try {
      const latest = await storage.getLatestRefresh();
      res.json({ lastRefresh: latest?.refreshedAt?.toISOString() || null });
    } catch (error) {
      res.status(500).json({ message: "Failed to get refresh status" });
    }
  });

  // ==================== UPLOAD HISTORY ROUTE ====================

  app.get("/api/uploads", requireAuth, async (req, res) => {
    try {
      const uploads = await storage.getAllUploads();
      res.json(uploads);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch upload history" });
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
      res.status(500).json({ message: "Export failed" });
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
      res.status(500).json({ message: "Export failed" });
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
      res.status(500).json({ message: "Export failed" });
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
      res.status(500).json({ message: "Export failed" });
    }
  });

  app.get("/api/export/projects-summary", async (req, res) => {
    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/projects-summary`);
      const summary = await response.json();
      const csv = generateCSV(summary, [
        "project_name", "size_kwp", "pd", "pm", "phase",
        "project_pct_complete", "expected_pct_complete", "delta_vs_expected",
        "actual_revenue", "actual_expenses", "gp_percent",
        "revenue_outstanding", "expenses_outstanding"
      ]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=projects_summary_export.csv");
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: "Export failed" });
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
