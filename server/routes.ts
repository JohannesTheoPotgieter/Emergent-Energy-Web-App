import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import multer from "multer";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { insertProjectSchema, insertExpenseSchema, insertRevenueSchema, insertTaskSchema, insertBudgetSchema } from "@shared/schema";
import { z } from "zod";
import { format } from "date-fns";

// Multer configuration for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
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

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
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
  
  // ==================== AUTH ROUTES ====================
  
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: { message: string }) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Login failed" });
      }
      req.logIn(user, (err) => {
        if (err) return next(err);
        return res.json({ 
          message: "Login successful", 
          user: { id: user.id, email: user.email, name: user.name, role: user.role } 
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
    if (req.isAuthenticated() && req.user) {
      return res.json({ 
        user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role } 
      });
    }
    res.status(401).json({ message: "Not authenticated" });
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

      const results: { file: string; status: string; message?: string; records?: number }[] = [];
      const requiredSheets = ["Expenditure Breakdown", "Revenue Tracking", "Project Plan"];

      for (const file of files) {
        try {
          const workbook = XLSX.read(file.buffer, { type: "buffer" });
          
          // Validate required sheets
          const missingSheets = requiredSheets.filter(sheet => !workbook.SheetNames.includes(sheet));
          if (missingSheets.length > 0) {
            results.push({
              file: file.originalname,
              status: "error",
              message: `Missing required sheets: ${missingSheets.join(", ")}`
            });
            await storage.createUpload({
              fileName: file.originalname,
              uploadedBy: req.user?.id || null,
              recordsProcessed: 0,
              validationErrors: `Missing sheets: ${missingSheets.join(", ")}`,
              status: "error"
            });
            continue;
          }

          // Extract project info from filename or first sheet
          const projectCode = file.originalname.replace(/\.(xlsx|xlsm|xls)$/i, "").substring(0, 20);
          let recordCount = 0;

          // Check if project exists or create new
          let project = await storage.getProjectByCode(projectCode);
          if (!project) {
            project = await storage.createProject({
              name: projectCode,
              code: projectCode,
              manager: "Imported",
              site: "TBD",
              status: "Active",
              stage: "Development",
              startDate: format(new Date(), "yyyy-MM-dd"),
              completionDate: format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"),
              budget: "0",
              sourceFile: file.originalname
            });
          } else {
            // Clear existing data for refresh
            await storage.deleteExpensesByProject(project.id);
            await storage.deleteRevenuesByProject(project.id);
            await storage.deleteTasksByProject(project.id);
            await storage.updateProject(project.id, { sourceFile: file.originalname });
          }

          // Parse Expenditure Breakdown sheet
          if (workbook.SheetNames.includes("Expenditure Breakdown")) {
            const sheet = workbook.Sheets["Expenditure Breakdown"];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
            
            const expenseRows: any[] = [];
            for (let i = 1; i < data.length; i++) {
              const row = data[i];
              if (row && row.length > 2 && row[0]) {
                expenseRows.push({
                  projectId: project.id,
                  category: "Procurement" as const,
                  description: String(row[1] || `Row ${i}`),
                  amount: String(parseFloat(row[2]) || 0),
                  date: format(new Date(), "yyyy-MM-dd"),
                  vendor: String(row[3] || "Unknown"),
                  status: "Forecast" as const,
                  sourceSheet: "Expenditure Breakdown",
                  rowLocator: i + 1
                });
              }
            }
            if (expenseRows.length > 0) {
              await storage.createManyExpenses(expenseRows);
              recordCount += expenseRows.length;
            }
          }

          // Parse Revenue Tracking sheet
          if (workbook.SheetNames.includes("Revenue Tracking")) {
            const sheet = workbook.Sheets["Revenue Tracking"];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
            
            const revenueRows: any[] = [];
            for (let i = 1; i < data.length; i++) {
              const row = data[i];
              if (row && row.length > 1 && row[0]) {
                revenueRows.push({
                  projectId: project.id,
                  type: "PPA" as const,
                  amount: String(parseFloat(row[1]) || 0),
                  date: format(new Date(), "yyyy-MM-dd"),
                  status: "Forecast" as const,
                  sourceSheet: "Revenue Tracking",
                  rowLocator: i + 1
                });
              }
            }
            if (revenueRows.length > 0) {
              await storage.createManyRevenues(revenueRows);
              recordCount += revenueRows.length;
            }
          }

          // Parse Project Plan sheet
          if (workbook.SheetNames.includes("Project Plan")) {
            const sheet = workbook.Sheets["Project Plan"];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
            
            const taskRows: any[] = [];
            for (let i = 1; i < data.length; i++) {
              const row = data[i];
              if (row && row.length > 1 && row[0]) {
                taskRows.push({
                  projectId: project.id,
                  taskName: String(row[0] || `Task ${i}`),
                  startDate: format(new Date(), "yyyy-MM-dd"),
                  endDate: format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"),
                  progress: 0,
                  status: "Not Started" as const,
                  assignee: String(row[2] || "TBD"),
                  sourceSheet: "Project Plan",
                  rowLocator: i + 1
                });
              }
            }
            if (taskRows.length > 0) {
              await storage.createManyTasks(taskRows);
              recordCount += taskRows.length;
            }
          }

          await storage.createUpload({
            fileName: file.originalname,
            uploadedBy: req.user?.id || null,
            recordsProcessed: recordCount,
            validationErrors: null,
            status: "success"
          });

          results.push({
            file: file.originalname,
            status: "success",
            records: recordCount
          });

        } catch (fileError: any) {
          results.push({
            file: file.originalname,
            status: "error",
            message: fileError.message || "Failed to process file"
          });
        }
      }

      // Create refresh log
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
      const expenses = await storage.getAllExpenses();
      const csv = generateCSV(expenses, [
        "id", "projectId", "category", "description", "amount", "date", 
        "vendor", "status", "sourceSheet", "rowLocator"
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
      const revenues = await storage.getAllRevenues();
      const csv = generateCSV(revenues, [
        "id", "projectId", "type", "amount", "date", "status", "sourceSheet", "rowLocator"
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

  return httpServer;
}

// Helper function to generate CSV
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
      // Escape quotes and wrap in quotes if contains comma
      if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(",")
  );
  
  return [header, ...rows].join("\n");
}
