import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from './shared-middleware';
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../permission-middleware";
import multer from "multer";
import fs from "fs";
import path from "path";
import { sanitizeFilename, allowedFileFilter } from "../lib/upload-security";
// Legacy `parseTrackerFile` / `applyFontColors` from "../excelParser" were
// imported here to support the now-410'd POST /api/upload and
// /api/reprocess-all handlers. Removed 2026-05-15 alongside the handler
// neutralisation; see docs/smart-import-v2-task-dedup-audit.md.
import { getStartupFlags } from "../startup-flags";
import { getFeatureFlags } from "../lib/feature-flags";
import { buildPhase1AReconciliationReport } from "../services/promoted-read-compat";
import { isPhase1ADomainEnabled, isPhase1AEndpointEnabled, type Phase1AFlagSet } from "../services/phase1a-reconciliation-policy";
import { queryStr, queryInt, paramStr, paramInt } from "../lib/req-parse";
import { logAuditFromReq } from "../audit-logger";
import {
  assertSharePointConnectionHealthyForEnable,
  normalizeSharePointFolderPath,
  type SharePointConnectionTestResult,
} from "../sharepoint";
import { ApiError } from "../lib/api-error";

/**
 * Body schema for POST /api/admin/sp-settings — used to validate the COO/CEO
 * input from the SharePoint Auto-Import admin panel. Bounds on
 * `intervalMinutes` prevent foot-guns (0 would tight-loop the in-process
 * scheduler, very large values silently disable the schedule). `enabled` is
 * a strict boolean, not a truthy-coerced field, so a stray string never
 * flips the scheduler on or off.
 */
const SP_SETTINGS_BODY = z.object({
  siteId: z.string().trim().min(1, "siteId is required"),
  driveId: z.string().trim().min(1, "driveId is required"),
  folderItemId: z.string().trim().nullable().optional(),
  folderPath: z.string().trim().nullable().optional(),
  intervalMinutes: z.number().int().min(1).max(1440).default(30),
  enabled: z.boolean().default(false),
}).strict();

const SP_TEST_BODY = z.object({
  siteId: z.string().trim().min(1, "siteId is required"),
  driveId: z.string().trim().min(1, "driveId is required"),
  folderItemId: z.string().trim().nullable().optional(),
  folderPath: z.string().trim().nullable().optional(),
}).strict();

const SP_IMPORT_SINGLE_BODY = z.object({
  driveId: z.string().trim().min(1, "driveId is required"),
  siteId: z.string().trim().min(1, "siteId is required"),
  itemId: z.string().trim().min(1, "itemId is required"),
}).strict();

const router = Router();

function parseJsonConfig(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function recordSharePointConnectionHealth(input: {
  userId: number | null;
  siteId: string;
  driveId: string;
  folderPath: string | null;
  result: SharePointConnectionTestResult;
}): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT config_value
      FROM ms_integration_settings
      WHERE config_key = 'sharepoint_project_docs'
      LIMIT 1
    `).then((r: any) => r.rows || r);
    const existing = parseJsonConfig(rows?.[0]?.config_value);
    const nextConfig = {
      ...existing,
      siteId: input.siteId,
      driveId: input.driveId,
      folderPath: input.folderPath,
      siteName: input.result.siteName ?? existing.siteName ?? null,
      driveName: input.result.driveName ?? existing.driveName ?? null,
      connectionStatus: input.result.ok ? "connected" : "error",
      lastTestedAt: new Date().toISOString(),
      lastErrorCode: input.result.ok ? null : input.result.failureCategory ?? "unknown",
      lastErrorMessage: input.result.ok ? null : input.result.message ?? null,
      lastFileCount: input.result.fileCount ?? null,
      firstFiveTrackerFilenames: input.result.firstFiveTrackerFilenames ?? [],
    };
    await db.execute(sql`
      INSERT INTO ms_integration_settings (config_key, config_value, updated_by, updated_at)
      VALUES ('sharepoint_project_docs', ${JSON.stringify(nextConfig)}::jsonb, ${input.userId}, NOW())
      ON CONFLICT (config_key) DO UPDATE SET
        config_value = ${JSON.stringify(nextConfig)}::jsonb,
        updated_by = ${input.userId},
        updated_at = NOW()
    `);
  } catch (err) {
    console.warn("[SharePoint] Failed to persist connection health:", err instanceof Error ? err.message : String(err));
  }
}

// `uploadDir` previously hosted the multer instance used by /api/upload and
// /api/reprocess-all. After those handlers were 410'd (see below) the
// instance was removed. The /api/admin/scan-folder handler in
// imports-admin-extracted-routes.ts still references this path via
// process.env.TRACKER_FOLDER_PATH, so the directory itself is kept on disk.
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ==================== HEALTH CHECK ====================

router.get("/api/health", async (req, res) => {
  const { dbMode } = await import("../db");
  const { getDbConfigStatus } = await import("../db-config");
  const { getStartupModes } = await import("../startup-modes");

  const dbStatus = getDbConfigStatus();
  const startupModes = getStartupModes();
  const startupFlags = getStartupFlags();

  const envDbMode = process.env.DB_MODE;
  const hasDatabaseUrl = !!process.env.DATABASE_URL;

  res.json({
    ok: dbStatus.connected,
    dbMode,
    dbConnected: dbStatus.connected,
    dbHost: dbStatus.host,
    dbError: dbStatus.error || null,
    envDbMode: envDbMode || 'auto',
    hasDatabaseUrl,
    startupFlags,
    startupFlagsRaw: startupModes.startupFlagsRaw,
    startupModes: {
      startupMaintenanceEnabled: startupModes.startupMaintenanceEnabled,
      startupSchemaRepairEnabled: startupModes.startupSchemaRepairEnabled,
      startupDataSeedEnabled: startupModes.startupDataSeedEnabled,
      startupBackfillEnabled: startupModes.startupBackfillEnabled,
      startupSessionResetEnabled: startupModes.startupSessionResetEnabled,
      startupUserSeedEnabled: startupModes.startupUserSeedEnabled,
      startupReadOnlyByDefault: startupModes.startupReadOnlyByDefault,
    },
    startupMutationClassification: startupModes.startupMutationClassification,
    startupReadOnlyByDefault: startupModes.startupReadOnlyByDefault,
    sqliteSchemaRepairEnabled: startupModes.startupSchemaRepairEnabled,
    message: dbStatus.message,
    timestamp: new Date().toISOString(),
  });
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
      cb(null, `${ts}_${sanitizeFilename(file.originalname)}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: allowedFileFilter,
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
  const resolvedPath = path.resolve(docUploadDir, path.basename(filename));
  if (!resolvedPath.startsWith(path.resolve(docUploadDir))) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.sendFile(resolvedPath);
});

// ==================== FILE UPLOAD ROUTE ====================

// POST /api/upload — DEPRECATED (returns 410 Gone).
//
// The legacy upload pipeline (excelParser + importPipeline) ran a full
// delete-and-reinsert against `work_items` via `storage.createManyProjectPlans`
// and `storage.deleteProjectPlansByProject` (themselves adapter façades over
// `work_items`). That pipeline bypasses every Smart Import v2 dedup guard
// (hash-based identity, 3-way merge, conflict detection, snapshot
// bookkeeping), so re-running it could silently corrupt task data committed
// through the v2 flow.
//
// No client or scheduler calls this endpoint today, but it was mounted and
// reachable. We keep the route registered so any future caller (manual curl,
// stale automation) receives an actionable 410 instead of a silent 404.
//
// See docs/smart-import-v2-task-dedup-audit.md for the full trace.
router.post("/api/upload", requireAuth, async (_req, res) => {
  res.status(410).json({
    error: "endpoint_deprecated",
    message: "POST /api/upload was removed because it bypasses Smart Import v2 dedup guards.",
    use: "POST /api/smart-import/upload",
  });
});

// ==================== REPROCESS ALL UPLOADS ====================

// POST /api/reprocess-all — DEPRECATED (returns 410 Gone).
//
// Same dedup-bypass anti-pattern as /api/upload above: scanned the uploads
// table, deleted every project's program/plan/cashflow rows via legacy
// storage methods, and re-inserted via `storage.createManyProjectPlans`
// (which routes to `work_items` without the v2 hash/snapshot guards).
// Reachable but uncalled today; 410'd to prevent future misuse.
router.post("/api/reprocess-all", requireAuth, requireAdmin, async (_req, res) => {
  res.status(410).json({
    error: "endpoint_deprecated",
    message: "POST /api/reprocess-all was removed because it bypasses Smart Import v2 dedup guards.",
    use: "POST /api/smart-import/upload per project",
  });
});

// ==================== WRITEBACK MAPPINGS ====================

router.get("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mappings = await storage.getAllWritebackMappings();
    res.json(mappings);
  } catch (err: any) {
    throw err;
  }
});

router.post("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mapping = await storage.createWritebackMapping(req.body);
    res.json(mapping);
  } catch (err: any) {
    throw err;
  }
});

router.patch("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateWritebackMapping(paramInt(req, "id")!, req.body);
    res.json(updated);
  } catch (err: any) {
    throw err;
  }
});

router.delete("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await storage.deleteWritebackMapping(paramInt(req, "id")!);
    res.json({ success: true });
  } catch (err: any) {
    throw err;
  }
});

// ==================== WRITEBACK AUDIT LOG ====================

router.get("/api/writeback-audit", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const mappingId = req.query.mappingId ? parseInt(req.query.mappingId as string) : undefined;
    const logs = await storage.getWritebackAuditLogs(mappingId);
    res.json(logs);
  } catch (err: any) {
    throw err;
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
    throw err;
  }
});

async function buildDataByEntity(): Promise<Record<string, any[]>> {
  const projects = await storage.getAllProjects();
  const expenses = await storage.getAllExpenses();
  const inflows = await storage.getAllRevenueLinesForCashflow();
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
    throw err;
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
    throw err;
  }
});

router.post("/api/writeback/rollback/:auditId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const auditId = paramInt(req, "auditId")!;
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
    throw err;
  }
});

// ==================== SHAREPOINT ADMIN ====================

router.get("/api/admin/sp-settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await storage.getSpSettings();
    res.json(settings || null);
  } catch (err: any) {
    throw err;
  }
});

router.post("/api/admin/sp-settings", requireAuth, requireAdmin, async (req, res) => {
  const parsed = SP_SETTINGS_BODY.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid sp-settings payload",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const body = parsed.data;
  const userId = typeof req.user?.id === "number" ? req.user.id : null;
  if (body.enabled) {
    try {
      const health = await assertSharePointConnectionHealthyForEnable(
        body.siteId,
        body.driveId,
        body.folderItemId ?? null,
        body.folderPath ?? null,
      );
      await recordSharePointConnectionHealth({
        userId,
        siteId: body.siteId,
        driveId: body.driveId,
        folderPath: normalizeSharePointFolderPath(body.folderPath) ?? null,
        result: health,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
          error: err.code,
          code: err.code,
          message: err.statusCode >= 500
            ? "SharePoint connection could not be verified."
            : "SharePoint connection validation failed.",
          nextAction: err.nextAction,
        });
      }
      throw err;
    }
  }
  const settings = await storage.upsertSpSettings({
    siteId: body.siteId,
    driveId: body.driveId,
    folderItemId: body.folderItemId ?? null,
    folderPath: normalizeSharePointFolderPath(body.folderPath) ?? null,
    intervalMinutes: body.intervalMinutes,
    enabled: body.enabled,
    updatedBy: userId,
  });
  logAuditFromReq(req, {
    entityType: "admin",
    action: "sp_settings_update",
    changesJson: {
      description: "SharePoint settings updated",
      siteId: body.siteId,
      driveId: body.driveId,
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled,
    },
  });
  res.json(settings);
});

router.post("/api/admin/sp-settings/test", requireAuth, requireAdmin, async (req, res) => {
  const parsed = SP_TEST_BODY.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "siteId and driveId are required",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const { testConnection } = await import("../sharepoint");
  const result = await testConnection(
    parsed.data.siteId,
    parsed.data.driveId,
    parsed.data.folderItemId ?? undefined,
    parsed.data.folderPath ?? undefined,
  );
  await recordSharePointConnectionHealth({
    userId: typeof req.user?.id === "number" ? req.user.id : null,
    siteId: parsed.data.siteId,
    driveId: parsed.data.driveId,
    folderPath: normalizeSharePointFolderPath(parsed.data.folderPath) ?? null,
    result,
  });
  logAuditFromReq(req, {
    entityType: "sp_settings",
    action: "test_connection",
    changesJson: {
      siteId: parsed.data.siteId,
      driveId: parsed.data.driveId,
      folderItemId: parsed.data.folderItemId ?? null,
      folderPath: normalizeSharePointFolderPath(parsed.data.folderPath) ?? null,
      ok: result.ok,
      failureCategory: result.failureCategory ?? null,
      fileCount: result.fileCount ?? null,
    },
  });
  res.json(result);
});

router.get("/api/admin/sp-browse", requireAuth, requireAdmin, async (req, res) => {
  const driveId = queryStr(req, "driveId");
  const folderId = queryStr(req, "folderId");
  if (!driveId) {
    return res.status(400).json({ error: "driveId is required" });
  }
  const { browseFolders } = await import("../sharepoint");
  const items = await browseFolders(driveId, folderId || undefined);
  res.json(items);
});

// ==================== SHAREPOINT IMPORT ====================

router.post("/api/admin/import/single", requireAuth, requireAdmin, async (req, res) => {
  const parsed = SP_IMPORT_SINGLE_BODY.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "driveId, siteId, and itemId are required",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const { importSingleFile } = await import("../importPipeline");
  const actor = req.user?.email || req.user?.name || "admin";
  const result = await importSingleFile(parsed.data.driveId, parsed.data.siteId, parsed.data.itemId, actor);
  logAuditFromReq(req, {
    entityType: "admin",
    action: "import_single_file",
    changesJson: {
      description: "Single SharePoint file imported manually",
      itemId: parsed.data.itemId,
    },
  });
  res.json(result);
});

router.post("/api/admin/import/run", requireAuth, requireAdmin, async (req, res) => {
  const actor = req.user?.email || req.user?.name || "admin";
  // Match the scheduled tick's pipeline selector so Run Now and the
  // scheduler never diverge — both pick V2 by default; opt out with
  // AUTO_IMPORT_V2_ENABLED=false. Accept ?force=true (or { force: true }
  // in body) to override the enabled-flag gate when a super-user wants
  // to test a paused configuration.
  const useV2 = process.env.AUTO_IMPORT_V2_ENABLED !== "false";
  const force = req.body?.force === true || req.query?.force === "true";

  let result: unknown;
  if (useV2) {
    const { runScheduledImportV2 } = await import("../services/scheduled-import-v2");
    const { storage: store } = await import("../storage");
    const settings = await store.getSpSettings();
    if (!settings) {
      return res.status(400).json({ error: "SharePoint settings not configured." });
    }
    if (!settings.enabled && !force) {
      return res.status(409).json({
        error: "SharePoint auto-import is currently disabled.",
        code: "SP_IMPORT_DISABLED",
        nextAction: "Enable the schedule first, or pass ?force=true to override.",
      });
    }
    result = await runScheduledImportV2({ triggerType: "manual", triggeredBy: actor });
  } else {
    const { runFullImport } = await import("../importPipeline");
    result = await runFullImport("manual", actor, { force });
  }

  logAuditFromReq(req, {
    entityType: "admin",
    action: "import_run",
    changesJson: {
      description: "Full SharePoint import triggered manually",
      pipeline: useV2 ? "v2" : "v1",
      force,
    },
  });
  res.json(result);
});

router.post("/api/admin/import/retry-failed", requireAuth, requireAdmin, async (req, res) => {
  const { retryFailedImports } = await import("../importPipeline");
  const actor = req.user?.email || req.user?.name || "admin";
  const result = await retryFailedImports(actor);
  logAuditFromReq(req, {
    entityType: "admin",
    action: "import_retry_failed",
    changesJson: { description: "Failed SharePoint imports retried manually" },
  });
  res.json(result);
});

router.get("/api/admin/import/runs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const runs = await storage.getAllImportRuns();
    res.json(runs);
  } catch (err: any) {
    throw err;
  }
});

router.get("/api/admin/import/runs/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const runId = paramInt(req, "id")!;
    const run = await storage.getImportRun(runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const entries = await storage.getAllChangeLedger({ runId });
    res.json({ run, entries });
  } catch (err: any) {
    throw err;
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
    throw err;
  }
});

router.put("/api/admin/ms-integration/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const key = paramStr(req, "key");
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
    throw err;
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
    console.error("[admin-routes] error:", err);
    res.json({ success: false, error: "Operation failed" });
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
    throw err;
  }
});

router.get("/api/admin/migration-verify", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { runMigrationVerification } = await import("../migration-verify");
    const report = await runMigrationVerification();
    res.json(report);
  } catch (err: any) {
    throw err;
  }
});

router.get("/api/admin/reconciliation/phase-1a", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const compareMode = req.query.compare === "1" || req.query.compare === "true";
    const flags = await getFeatureFlags([
      "migration_bridge_project_read_v1",
      "migration_bridge_lifecycle_read_v1",
      "migration_bridge_approvals_dual_read_v1",
      "migration_bridge_finance_read_v1",
      "migration_bridge_deliverables_read_v1",
      "migration_bridge_party_read_v1",
    ]);
    if (!isPhase1AEndpointEnabled(compareMode, flags as unknown as Phase1AFlagSet)) {
      return res.status(403).json({
        error: "feature_flag_disabled",
        message: "Phase 1A reconciliation endpoint is disabled. Enable migration_bridge_project_read_v1 or use compare mode.",
      });
    }

    const report = await buildPhase1AReconciliationReport();
    const requestedDomains = report.checks.filter((check) => isPhase1ADomainEnabled(check.domain, compareMode, flags as unknown as Phase1AFlagSet));

    res.json({
      generatedAt: report.generatedAt,
      diagnosticsMode: {
        compareMode,
        flags,
      },
      checks: requestedDomains.map((check) => ({
        domain: check.domain,
        status: check.status,
        legacyCount: check.legacyCount,
        promotedCount: check.promotedCount,
        deltaCount: check.deltaCount,
        mismatchCategories: check.mismatchCategories,
        notes: check.notes,
        thresholdEvaluation: check.thresholdEvaluation,
      })),
    });
  } catch (err: any) {
    console.error("[admin-routes] Phase 1A reconciliation error:", err);
    res.status(500).json({ error: "Failed to generate Phase 1A reconciliation report" });
  }
});

export function registerAdminRoutes(app: Express) {
  app.use(router);
}
