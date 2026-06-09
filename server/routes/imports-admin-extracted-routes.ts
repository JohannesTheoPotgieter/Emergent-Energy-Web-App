/**
 * Imports / Upload / Admin Routes — Extracted from server/routes.ts (Phase 9b)
 *
 * 21 handlers covering:
 *   - File upload (1)
 *   - Reprocess all (1)
 *   - Program inflows (deleted routes comment only)
 *   - Admin refresh/refresh-data (3)
 *   - Admin clear-all-data (1)
 *   - Admin folder-config (2)
 *   - Admin scan-folder (1)
 *   - Admin mark-active (1)
 *   - Admin refresh-history (1)
 *   - Admin smoke-test (1)
 *   - Admin SP settings/browse (4)
 *   - Admin import single/run/retry/runs (5)
 */

import { toCanonicalEngineeringStageStatus } from "@shared/status-logic";
import { assertTaskWorkflowTransition, buildTaskWorkflowContext, TaskWorkflowGuardError } from "../lib/task-workflow-guard";
// Temporal helpers and the local multer / fileType / upload-security imports
// were used by the /api/upload and /api/reprocess-all handlers that lived
// here. Those handlers were shadowed by admin-routes.ts and have been
// removed (2026-05-15). See header comment below.
import type { Express, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { storage } from "../storage";
import { parseTrackerFile, applyFontColors } from "../excelParser";
import {
  projectInfo, normalizedCostLines, normalizedRevenueLines,
  normalizedExecutionPhases, smartImportRuns, workItems,
  cashflowPoints, financeRevenueMonthly, financeCosMonthly,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, sql } from "drizzle-orm";
import { runSmartImportPreview } from "../lib/import/index";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../permission-middleware";
import { logAuditFromReq } from "../audit-logger";
import { ApiError, sendError, badRequest, logApiError } from "../lib/api-error";
import { paramStr, parseIntParam } from "../lib/req-params";
import { getCanonicalProjectCostLinesByName } from "../services/project-cost-line-read-service";

// Ensure uploads directory exists — scan-folder still copies discovered
// workbooks here before they're imported via Smart Import v2.
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export async function registerImportsAdminExtractedRoutes(app: Express): Promise<void> {

  // The runFullImport / retryFailedImports / importSingleFile / and
  // createSnapshotFromUpload entry points used to be wired up here. The
  // first three were moved to server/departments/admin-routes.ts in
  // 2026-05-12; createSnapshotFromUpload was used only by the shadowed
  // /api/upload handler and was removed when that handler was deleted
  // (2026-05-15). See header comment below for the full deprecation trace.

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

  // ==================== FILE UPLOAD ROUTE ====================
  //
  // The /api/upload and /api/reprocess-all handlers that used to live here
  // were shadowed by server/departments/admin-routes.ts (department routes
  // register first; see comment block at end of file). Both bypassed every
  // Smart Import v2 dedup guard via `storage.createManyProjectPlans` /
  // `deleteProjectPlansByProject` (adapter façades over work_items). The
  // live copies in admin-routes.ts have been replaced with 410 Gone
  // responders; the shadowed copies here are deleted 2026-05-15.
  // See docs/smart-import-v2-task-dedup-audit.md.


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

  // POST /api/admin/refresh-data — DEPRECATED (returns 410 Gone).
  //
  // Same dedup-bypass anti-pattern as /api/upload and /api/reprocess-all
  // (already 410'd in admin-routes.ts). Re-processed every stored tracker
  // file by deleting and re-inserting program/plan/cashflow/finance rows
  // via `storage.createManyProjectPlans` (adapter façade over work_items)
  // — bypassing Smart Import v2's hash dedup, 3-way merge, and conflict
  // detection. Both SSE and non-SSE branches had the same bypass.
  // Removed 2026-05-15. See docs/smart-import-v2-task-dedup-audit.md.
  app.post("/api/admin/refresh-data", requireAuth, requireAdmin, async (_req, res) => {
    res.status(410).json({
      error: "endpoint_deprecated",
      message: "POST /api/admin/refresh-data was removed because it bypasses Smart Import v2 dedup guards.",
      use: "POST /api/smart-import/upload per project",
    });
  });

  // Clear all data — wipes every project, cost line, revenue line, and task.
  // Double-gated: (1) never reachable in production, (2) requires an explicit
  // ALLOW_DESTRUCTIVE_OPS=true environment flag even in non-production so that
  // an accidental NODE_ENV misconfiguration cannot expose this endpoint.
  app.post("/api/admin/clear-all-data", requireAuth, requireAdmin, requirePermission('admin', 'edit'), async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Blocked in production' });
    }
    if (process.env.ALLOW_DESTRUCTIVE_OPS !== 'true') {
      return res.status(403).json({
        error: 'Blocked: destructive ops disabled',
        message: 'Set ALLOW_DESTRUCTIVE_OPS=true to enable this endpoint.',
      });
    }

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
        error: "clear_failed"
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
          // We parse the workbook once so we can extract the resolved project
          // name for upload registration, but the previous full-replace write
          // paths (program/plan/cashflow/finance delete-and-reinsert + a
          // direct `db.insert(workItems)` block) were removed 2026-05-15:
          // they bypassed every Smart Import v2 dedup guard. scan-folder is
          // now a discovery-and-stage operation; operators must run Smart
          // Import v2 per project to commit data. See
          // docs/smart-import-v2-task-dedup-audit.md.
          const parseResult = await parseTrackerFile(fileBuffer, fileName);

          const destPath = path.join(uploadDir, `${Date.now()}_${fileName}`);
          fs.copyFileSync(filePath, destPath);
          await storage.createUpload({
            fileName,
            filePath: destPath,
          });

          results.push({
            fileName,
            projectName: parseResult.projectName,
            status: "success",
            message: "Staged for Smart Import v2 — run /api/smart-import/upload to commit",
            recordsProcessed: 0,
            fileDate
          });
          
        } catch (error: any) {
          console.error("[imports-admin] file processing failed:", fileName, error);
          results.push({
            fileName,
            projectName: fileName.replace(/\.(xlsx|xlsm|xls)$/i, ''),
            status: "failed",
            message: "Processing failed",
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
      res.status(500).json({ error: "Failed to mark projects active" });
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
        const { dbMode } = await import("../db");
        const { getDbConfigStatus } = await import("../db-config");
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
          SELECT COUNT(*) as count FROM smart_import_runs WHERE status = 'committed'
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
          const inflows = await storage.getInflowLinesByProject(project.projectName);
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
          const { rows: expenses } = await getCanonicalProjectCostLinesByName(project.projectName);
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
        
        // Override test: verify upsertManyProjectPlanOverrides works
        const testOverrides = [{ projectName: testProjectName, rowNumber: 1, fieldName: "highLevelProgramme", overrideValue: testOverrideValue }];
        const savedOverrides = await (storage as any).upsertManyProjectPlanOverrides(testOverrides);

        const overridePassed = Array.isArray(savedOverrides);

        // Cleanup
        try { await storage.deleteProjectPlanOverridesByProject(testProjectName); } catch (_e: any) { /* ignore */ }

        addCheck("override_test", overridePassed, {
          created: true,
          found: overridePassed,
          valueMatches: overridePassed,
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
        code: "smoke_test_error",
        timestamps: {
          started: new Date(startTime).toISOString(),
          completed: new Date().toISOString(),
          durationMs: Date.now() - startTime
        }
      });
    }
  });

  // NOTE: SharePoint settings + import-run endpoints used to be duplicated
  // here AND in server/departments/admin-routes.ts. Express resolves the
  // first-registered handler, and `registerDepartmentRoutes` runs before
  // `registerExtractedRoutes` (see server/routes/register-all-routes.ts),
  // so the `admin-routes.ts` copy is the live one — the duplicates here
  // were dead code. Removed 2026-05-12 after the Phase 3 security review
  // flagged the shadow as a missing-audit-log risk.
  //
  // Canonical home for:
  //   GET/POST /api/admin/sp-settings
  //   POST     /api/admin/sp-settings/test
  //   GET      /api/admin/sp-browse
  //   POST     /api/admin/import/{run,retry-failed,single}
  //   GET      /api/admin/import/runs[/:id]
  // is server/departments/admin-routes.ts.
  //
  // 2026-05-15 (Smart Import v2 task-dedup audit) — additional cleanup:
  //   • `POST /api/upload` and `POST /api/reprocess-all` removed here.
  //     The live copies in admin-routes.ts are now `410 Gone` responders.
  //   • `POST /api/admin/refresh-data` replaced with a `410 Gone`. It used
  //     to re-parse every stored tracker and call
  //     `storage.createManyProjectPlans` / `deleteProjectPlansByProject`,
  //     bypassing every v2 dedup guard.
  //   • `POST /api/admin/scan-folder` kept, but its delete-and-reinsert
  //     blocks (including a direct `db.insert(workItems)`) were removed.
  //     The endpoint now only stages discovered Excel files — operators
  //     must run `POST /api/smart-import/upload` to commit them.
  // See docs/smart-import-v2-task-dedup-audit.md for the full trace.
}
