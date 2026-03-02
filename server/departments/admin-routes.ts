import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../permission-middleware";
import passport from "passport";
import multer from "multer";
import fs from "fs";
import path from "path";
import { generateToken, verifyToken } from "../jwt";
import { parseTrackerFile, applyFontColors } from "../excelParser";

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

function safeguardImportProjectInfo(info: any): any {
  if (info.phase && !info.executionPhase) {
    info.executionPhase = info.phase;
  }
  info.executionEnabled = false;
  return info;
}

// ==================== HEALTH CHECK ====================

router.get("/api/health", async (req, res) => {
  const { dbMode } = await import("../db");
  const { getDbConfigStatus } = await import("../db-config");

  const dbStatus = getDbConfigStatus();

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

router.get("/api/auth/status", async (req, res) => {
  try {
    const { dbMode } = await import("../db");
    const { getDbConfigStatus } = await import("../db-config");
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

router.post("/api/auth/login", async (req, res, next) => {
  const { dbMode } = await import("../db");

  passport.authenticate("local", (err: any, user: Express.User | false, info: { message: string }) => {
    if (err) {
      console.error("[LOGIN ERROR] Full error:", err);
      console.error("[LOGIN ERROR] Stack trace:", err.stack);

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

router.post("/api/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed", message: "Logout failed" });
    }
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/api/auth/me", (req, res) => {
  if (req.isAuthenticated() && req.user) {
    return res.json({
      user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role }
    });
  }

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

// ==================== FINANCIAL CLOSE ====================

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

router.post("/api/financial-close/upload", requireAuth, requireAdmin, docUpload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const fileUrl = `/api/financial-close/files/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.originalname });
});

router.get("/api/financial-close/files/:filename", requireAuth, (req, res) => {
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

// ==================== FILE UPLOAD ROUTE ====================

const multiUpload = upload.fields([
  { name: 'files', maxCount: 20 },
  { name: 'file', maxCount: 20 },
  { name: 'tracker', maxCount: 20 },
  { name: 'trackers', maxCount: 20 }
]);

router.post("/api/upload", requireAuth, multiUpload, async (req, res) => {
  const { createSnapshotFromUpload } = await import("../importPipeline");
  try {
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

    const mode = (req.body?.mode as string) || 'refresh';
    const resetOverrides = req.body?.resetOverrides === 'true';

    for (const file of files) {
      try {
        const fileBuffer = fs.readFileSync(file.path);
        const parseResult = await parseTrackerFile(fileBuffer, file.originalname);

        await applyFontColors(parseResult.expenses, fileBuffer);

        const sanitizeRecord = (record: Record<string, any>) => {
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

        let targetProjectName = parseResult.projectName;
        if (mode === 'duplicate') {
          const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          targetProjectName = `${parseResult.projectName}_${timestamp}`;
          if (parseResult.projectInfo) {
            parseResult.projectInfo.projectName = targetProjectName;
          }
          parseResult.expenses.forEach(e => e.projectName = targetProjectName);
          parseResult.inflows.forEach(i => i.projectName = targetProjectName);
          parseResult.planItems.forEach(p => p.projectName = targetProjectName);
          parseResult.cashflowPoints.forEach(c => c.projectName = targetProjectName);
          parseResult.financeRevenueMonthly.forEach(r => r.projectName = targetProjectName);
          parseResult.financeCosMonthly.forEach(c => c.projectName = targetProjectName);
        }

        await storage.transaction(async (txStorage) => {
          if (mode !== 'duplicate') {
            await txStorage.deleteProgramExpensesByProject(targetProjectName);
            await txStorage.deleteProgramInflowsByProject(targetProjectName);
            await txStorage.deleteProjectPlansByProject(targetProjectName);
            await txStorage.deleteCashflowPointsByProject(targetProjectName);
            await txStorage.deleteFinanceRevenueMonthlyByProject(targetProjectName);
            await txStorage.deleteFinanceCosMonthlyByProject(targetProjectName);

            if (resetOverrides) {
              await txStorage.deletePlanningOverridesByProject(targetProjectName);
            }
          }

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

          await txStorage.createUpload({
            fileName: file.originalname,
            filePath: file.path,
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

      } catch (fileError: any) {
        console.error("File parse/upload error:", fileError);
        const { dbMode } = await import("../db");

        results.push({
          file: file.originalname,
          status: "error",
          message: fileError.message || "Failed to process file"
        });

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
    const { dbMode } = await import("../db");
    res.status(500).json({
      error: error.message || "Failed to process upload",
      message: error.message || "Failed to process upload",
      code: error.code || 'UPLOAD_ERROR',
      dbMode
    });
  }
});

// ==================== REPROCESS ALL UPLOADS ====================

router.post("/api/reprocess-all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const uploads = await storage.getAllUploads();
    const reprocessResults: { fileName: string; status: string; message?: string }[] = [];

    const projectFiles = new Map<string, { filePath: string; fileName: string }>();
    for (const upload of uploads) {
      if (!upload.filePath) continue;

      const projectName = upload.fileName.replace(/_Tracker\.(xlsx|xlsm|xls)$/i, '');

      if (!projectFiles.has(projectName)) {
        projectFiles.set(projectName, { filePath: upload.filePath, fileName: upload.fileName });
      }
    }

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

        await storage.deleteProgramExpensesByProject(parseResult.projectName);
        await storage.deleteProgramInflowsByProject(parseResult.projectName);
        await storage.deleteProjectPlansByProject(parseResult.projectName);
        await storage.deleteCashflowPointsByProject(parseResult.projectName);
        await storage.deleteFinanceRevenueMonthlyByProject(parseResult.projectName);
        await storage.deleteFinanceCosMonthlyByProject(parseResult.projectName);

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

    res.json({
      message: `Reprocessed ${projectFiles.size} project(s)`,
      results: reprocessResults
    });

  } catch (error: any) {
    console.error("Reprocess error:", error);
    const { dbMode } = await import("../db");
    res.status(500).json({
      error: error.message || "Failed to reprocess files",
      message: error.message || "Failed to reprocess files",
      code: error.code || 'REPROCESS_ERROR',
      dbMode
    });
  }
});

// ==================== WRITEBACK MAPPINGS ====================

router.get("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mappings = await storage.getAllWritebackMappings();
    res.json(mappings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mapping = await storage.createWritebackMapping(req.body);
    res.json(mapping);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateWritebackMapping(parseInt(req.params.id), req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await storage.deleteWritebackMapping(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== WRITEBACK AUDIT LOG ====================

router.get("/api/writeback-audit", requireAuth, requireAdmin, async (req: Request, res: Response) => {
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

router.get("/api/writeback/workbook-sheets", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { path: wbPath } = req.query;
    if (!wbPath) return res.status(400).json({ error: "path query param required" });
    const check = validateWorkbookPath(wbPath as string);
    if (!check.safe) return res.status(400).json({ error: check.error });
    const { getWorkbookSheets } = await import("../lib/writebackEngine");
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

router.post("/api/writeback/preview", requireAuth, requireAdmin, async (req: Request, res: Response) => {
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

    const { previewWriteback } = await import("../lib/writebackEngine");
    const preview = await previewWriteback(check.resolved, mappings, dataByEntity);
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/writeback/execute", requireAuth, requireAdmin, async (req: Request, res: Response) => {
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

    const { executeWriteback, writeToWorkbook } = await import("../lib/writebackEngine");
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

router.post("/api/writeback/rollback/:auditId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const auditId = parseInt(req.params.auditId);
    const logs = await storage.getWritebackAuditLogs();
    const auditEntry = logs.find((l: any) => l.id === auditId);
    if (!auditEntry) return res.status(404).json({ error: "Audit entry not found" });
    if (auditEntry.rolledBackAt) return res.status(400).json({ error: "Already rolled back" });
    if (auditEntry.previousValue === null) return res.status(400).json({ error: "No previous value to restore" });

    const rollbackCheck = validateWorkbookPath(auditEntry.workbookPath);
    if (!rollbackCheck.safe) return res.status(400).json({ error: rollbackCheck.error });

    const { writeToWorkbook } = await import("../lib/writebackEngine");
    const result = await writeToWorkbook(rollbackCheck.resolved, [{
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

// ==================== SHAREPOINT ADMIN ====================

router.get("/api/admin/sp-settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await storage.getSpSettings();
    res.json(settings || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/sp-settings", requireAuth, requireAdmin, async (req, res) => {
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
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/sp-settings/test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { siteId, driveId } = req.body;
    if (!siteId || !driveId) {
      return res.status(400).json({ error: "siteId and driveId are required" });
    }
    const { testConnection } = await import("../sharepoint");
    const result = await testConnection(siteId, driveId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/sp-browse", requireAuth, requireAdmin, async (req, res) => {
  try {
    const driveId = req.query.driveId as string;
    const folderId = req.query.folderId as string | undefined;
    if (!driveId) {
      return res.status(400).json({ error: "driveId is required" });
    }
    const { browseFolders } = await import("../sharepoint");
    const items = await browseFolders(driveId, folderId || undefined);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SHAREPOINT IMPORT ====================

router.post("/api/admin/import/single", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { driveId, siteId, itemId } = req.body;
    if (!driveId || !siteId || !itemId) {
      return res.status(400).json({ error: "driveId, siteId, and itemId are required" });
    }
    const { importSingleFile } = await import("../importPipeline");
    const user = req.user as any;
    const result = await importSingleFile(driveId, siteId, itemId, user?.email || user?.name || "admin");
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/import/run", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { runFullImport } = await import("../importPipeline");
    const user = req.user as any;
    const result = await runFullImport("manual", user?.email || user?.name || "admin");
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/import/retry-failed", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { retryFailedImports } = await import("../importPipeline");
    const user = req.user as any;
    const result = await retryFailedImports(user?.email || user?.name || "admin");
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/import/runs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const runs = await storage.getAllImportRuns();
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/import/runs/:id", requireAuth, requireAdmin, async (req, res) => {
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

// ==================== SP FILES ====================

router.get("/api/sp-files", requireAuth, requireAdmin, async (req, res) => {
  try {
    const files = await storage.getAllSpFiles();
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MS INTEGRATION SETTINGS ====================

router.get("/api/admin/ms-integration", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.execute(sql`SELECT config_key, config_value FROM ms_integration_settings`);
    const config: Record<string, any> = {};
    for (const row of rows.rows) {
      config[row.config_key as string] = row.config_value;
    }
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/admin/ms-integration/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const allowed = ["feature_flags", "sharepoint_project_docs", "teams_config"];
    if (!allowed.includes(key)) {
      return res.status(400).json({ error: "Invalid config key" });
    }
    const userId = (req.user as any)?.id || null;
    await db.execute(sql`
      INSERT INTO ms_integration_settings (config_key, config_value, updated_by, updated_at)
      VALUES (${key}, ${JSON.stringify(req.body)}::jsonb, ${userId}, NOW())
      ON CONFLICT (config_key) DO UPDATE SET config_value = ${JSON.stringify(req.body)}::jsonb, updated_by = ${userId}, updated_at = NOW()
    `);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/ms-integration/test-sharepoint", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { siteUrl } = req.body;
    if (!siteUrl) {
      return res.status(400).json({ error: "siteUrl is required" });
    }

    const { getAccessToken: getSpToken } = await import("../sharepoint");

    let resolvedSiteUrl = siteUrl.trim();
    if (resolvedSiteUrl.endsWith("/")) resolvedSiteUrl = resolvedSiteUrl.slice(0, -1);

    const urlMatch = resolvedSiteUrl.match(/^https?:\/\/([^/]+)(\/sites\/[^/]+)?/i);
    if (!urlMatch) {
      return res.status(400).json({ error: "Invalid SharePoint URL format. Expected: https://tenant.sharepoint.com/sites/SiteName" });
    }
    const hostname = urlMatch[1];
    const sitePath = urlMatch[2] || "";

    const token = await getSpToken();
    
    const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!siteRes.ok) {
      const errText = await siteRes.text();
      return res.json({ success: false, error: `Could not resolve site: ${siteRes.status} - ${errText}` });
    }
    const siteData = await siteRes.json();

    const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteData.id}/drives`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!drivesRes.ok) {
      const errBody = await drivesRes.text().catch(() => "");
      console.error(`[SharePoint] Drives fetch failed: ${drivesRes.status} ${errBody}`);
      return res.json({ success: true, siteId: siteData.id, siteName: siteData.displayName, drives: [], drivesError: `Could not list drives: ${drivesRes.status}. Check that the app has Sites.Read.All permission in Azure AD.` });
    }
    const drivesData = await drivesRes.json();
    const drives = (drivesData.value || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      webUrl: d.webUrl,
    }));

    res.json({
      success: true,
      siteId: siteData.id,
      siteName: siteData.displayName,
      siteWebUrl: siteData.webUrl,
      drives,
    });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

router.post("/api/admin/ms-integration/browse-drive", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { driveId, folderId } = req.body;
    if (!driveId) return res.status(400).json({ error: "driveId is required" });

    const { browseFolders } = await import("../sharepoint");
    const items = await browseFolders(driveId, folderId || undefined);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerAdminRoutes(app: Express) {
  app.use(router);
}
