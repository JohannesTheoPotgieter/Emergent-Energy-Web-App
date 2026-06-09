/**
 * Support Routes — Extracted from server/routes.ts (Phase 3a)
 *
 * 30 handlers covering:
 *   - Settings / Feature flags (3)
 *   - UX role-aware interaction (1)
 *   - Version (1)
 *   - Health check (1)
 *   - Uploads listing (1)
 *   - Export / CSV (5)
 *   - Writeback mappings CRUD (4)
 *   - Writeback audit (1)
 *   - Writeback execution (4)
 *   - Error log (1)
 *   - Feedback tickets (4)
 *   - User project folders (3)
 *   - Global error handler (1 middleware)
 */

import type { Express, Request, Response, NextFunction } from "express";
import path from "path";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { feedbackTickets, userProjectFolders } from "@shared/schema";
import { requireAuth } from "../auth-context";
import { requireAdmin } from "../middleware/requireAdmin";
import { logAuditFromReq } from "../audit-logger";
import { ApiError, sendError, logApiError } from "../lib/api-error";
import { paramStr, parseIntParam } from "../lib/req-params";
import { getCanonicalAllCurrentCostLines } from "../services/project-cost-line-read-service";

// ── generateCSV helper (moved from routes.ts) ──

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

// ── Writeback helpers (moved from routes.ts) ──

const safeUploadsDir = path.resolve(process.cwd(), 'uploads');

function validateWorkbookPath(wbPath: string): { safe: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(safeUploadsDir, wbPath);
  if (!resolved.startsWith(safeUploadsDir)) {
    return { safe: false, resolved, error: "Path must be within the uploads directory" };
  }
  return { safe: true, resolved };
}

async function buildDataByEntity(): Promise<Record<string, any[]>> {
  const projects = await storage.getAllProjects();
  const expenses = await storage.getAllExpenses();
  const inflows = await storage.getAllRevenueLinesForCashflow();
  return { project: projects, expense: expenses, inflow: inflows, plan: [] };
}

// ── Main registration function ──

export async function registerSupportExtractedRoutes(app: Express): Promise<void> {

  // ==================== SETTINGS / FEATURE FLAGS ====================

  app.get("/api/settings", requireAuth, async (req, res) => {
    try {
      const key = req.query.key as string;
      if (!key) return res.status(400).json({ error: "key parameter required" });
      const { getFeatureFlag } = await import("../lib/feature-flags");
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
      const { setFeatureFlag } = await import("../lib/feature-flags");
      await setFeatureFlag(key, !!value, (req as any).user?.name || "admin");
      logAuditFromReq(req, { entityType: "settings", action: "update", changesJson: { key, value: !!value }, source: "SETTINGS" });
      res.json({ success: true, key, value: !!value });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update setting" });
    }
  });

  app.get("/api/feature-flags/rollout", requireAuth, async (req, res) => {
    try {
      const { getRolloutFeatureFlags } = await import("../lib/feature-flags");
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

  // ==================== UX ROLE-AWARE INTERACTION ====================

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

  // ==================== VERSION / HEALTH ====================

  app.get("/api/version", async (_req, res) => {
    try {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      if (process.env.NODE_ENV === "production") {
        const bvPath = pathMod.default.resolve("dist/public/build-version.json");
        const data = JSON.parse(await fs.readFile(bvPath, "utf-8"));
        let releaseNotes: { title: string; description: string }[] = [];
        try {
          const rnPath = pathMod.default.resolve("dist/public/release-notes.json");
          const rnData = JSON.parse(await fs.readFile(rnPath, "utf-8"));
          releaseNotes = rnData.notes || [];
        } catch (e) { console.warn("[support-extracted-routes] non-critical error:", e instanceof Error ? e.message : e); }
        return res.json({ version: data.version, buildTime: data.buildTime, buildId: data.buildId, buildNumber: data.buildNumber || null, releaseNotes });
      }
      const vPath = pathMod.default.resolve("version.json");
      const data = JSON.parse(await fs.readFile(vPath, "utf-8"));
      const version = `${data.major}.${data.minor}.${data.patch}`;
      const lu = data.lastUpdated ? new Date(data.lastUpdated) : new Date();
      const buildNumber = `${String(lu.getFullYear()).slice(2)}${String(lu.getMonth() + 1).padStart(2, "0")}${String(lu.getDate()).padStart(2, "0")}`;
      let releaseNotes: { title: string; description: string }[] = [];
      try {
        const rnPath = pathMod.default.resolve("release-notes.json");
        const rnData = JSON.parse(await fs.readFile(rnPath, "utf-8"));
        releaseNotes = rnData.notes || [];
      } catch (e) { console.warn("[support-extracted-routes] non-critical error:", e instanceof Error ? e.message : e); }
      return res.json({ version, buildTime: data.lastUpdated, buildId: null, buildNumber, releaseNotes });
    } catch (error) {
      // Prompt 0.12 follow-up: the client version-check polls /api/version
      // every 5 minutes and treats a changed payload as "new build
      // available". Returning a synthetic "0.0.001" fallback on read error
      // would flip the signature from real → fallback → real on a
      // transient fs failure and spuriously trigger the banner. Instead,
      // return a 503 with an explicit error so useVersionCheck keeps
      // the previously-known signature and simply retries on the next
      // poll. The catch here exists for visibility only; the client
      // treats a 503 as "no update yet".
      logApiError("GET /api/version", error);
      return res.status(503).json({ error: "version_unavailable" });
    }
  });

  app.get("/api/health", async (_req, res) => {
    try {
      const { dbMode } = await import("../db");
      const { getDbConfigStatus } = await import("../db-config");
      const { getStartupModes } = await import("../startup-modes");
      const { buildHealthDiagnostics } = await import("../health-diagnostics");

      const dbStatus = getDbConfigStatus();
      const startupModes = getStartupModes();

      // Live readiness re-check so a behind-schema DB reports 503 and a
      // since-repaired one self-clears without a restart. Fail open: if the
      // check itself errors, health still reports its DB diagnostics.
      let schemaReadiness = null;
      try {
        const { evaluateAppSchemaReadiness } = await import("../bootstrap/schema-readiness-runtime");
        schemaReadiness = await evaluateAppSchemaReadiness();
      } catch (readinessErr) {
        logApiError("GET /api/health schema readiness", readinessErr);
      }

      const diagnostics = buildHealthDiagnostics(dbMode, dbStatus, startupModes, schemaReadiness);
      res.status(diagnostics.ok ? 200 : 503).json(diagnostics);
    } catch (error) {
      logApiError("GET /api/health", error);
      return sendError(res, new ApiError(500, "HEALTH_CHECK_FAILED", "Failed to collect health diagnostics."));
    }
  });

  // ==================== UPLOADS LISTING ====================

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
      const expenses = await getCanonicalAllCurrentCostLines();
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
      const revenues = await storage.getAllRevenueLinesForCashflow();
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
      const authHeader = req.headers.authorization || "";
      const response = await fetch(`http://0.0.0.0:${process.env.PORT || 5000}/api/projects-summary`, {
        headers: { Authorization: authHeader },
      });
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

  // ==================== WRITEBACK MAPPINGS CRUD ====================

  app.get("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getAllWritebackMappings();
      res.json(mappings);
    } catch (err: any) {
      throw err;
    }
  });

  app.post("/api/writeback-mappings", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mapping = await storage.createWritebackMapping(req.body);
      logAuditFromReq(req, { entityType: "writeback_mapping", action: "create", entityId: String(mapping.id), changesJson: { description: "Writeback mapping created" } });
      res.json(mapping);
    } catch (err: any) {
      throw err;
    }
  });

  app.patch("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateWritebackMapping(id, req.body);
      logAuditFromReq(req, { entityType: "writeback_mapping", action: "update", entityId: paramStr(req.params.id), changesJson: { description: "Writeback mapping updated" } });
      res.json(updated);
    } catch (err: any) {
      throw err;
    }
  });

  app.delete("/api/writeback-mappings/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteWritebackMapping(id);
      logAuditFromReq(req, { entityType: "writeback_mapping", action: "delete", entityId: paramStr(req.params.id), changesJson: { description: "Writeback mapping deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== WRITEBACK AUDIT LOG ====================

  app.get("/api/writeback-audit", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const mappingId = req.query.mappingId ? parseInt(req.query.mappingId as string) : undefined;
      const logs = await storage.getWritebackAuditLogs(mappingId);
      res.json(logs);
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== WRITEBACK EXECUTION ====================

  app.get("/api/writeback/workbook-sheets", requireAuth, requireAdmin, async (req: Request, res: Response) => {
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

      const { previewWriteback } = await import("../lib/writebackEngine");
      const preview = await previewWriteback(check.resolved, mappings, dataByEntity);
      res.json(preview);
    } catch (err: any) {
      throw err;
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

      logAuditFromReq(req, { entityType: "writeback", action: "execute", changesJson: { description: "Writeback executed", workbookPath, mappingCount: mappings.length, success: writeResult.success } });
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

  app.post("/api/writeback/rollback/:auditId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const auditId = parseIntParam(req.params.auditId);
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

      logAuditFromReq(req, { entityType: "writeback", action: "rollback", entityId: String(auditId), changesJson: { description: "Writeback rolled back", cellAddress: auditEntry.cellAddress, previousValue: auditEntry.previousValue } });
      res.json({ success: result.success, error: result.error });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== ERROR LOG ====================

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

  // ==================== FEEDBACK / BUG REPORTS ====================

  app.get("/api/feedback", requireAuth, async (req, res) => {
    try {
      const tickets = await db.select().from(feedbackTickets).where(isNull(feedbackTickets.deletedAt)).orderBy(desc(feedbackTickets.createdAt));
      res.json(tickets);
    } catch (err: any) {
      throw err;
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
      throw err;
    }
  });

  app.patch("/api/feedback/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
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
      throw err;
    }
  });

  app.delete("/api/feedback/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      await db.delete(feedbackTickets).where(eq(feedbackTickets.id, id));
      logAuditFromReq(req, { entityType: "feedback", action: "delete", entityId: String(id), changesJson: { description: "Feedback ticket deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== USER PROJECT FOLDERS ====================

  app.get("/api/user-project-folder/:projectName", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const projectName = decodeURIComponent(paramStr(req.params.projectName));

      const [folder] = await db.select()
        .from(userProjectFolders)
        .where(and(
          eq(userProjectFolders.userId, userId),
          eq(userProjectFolders.projectName, projectName)
        ));

      res.json(folder || null);
    } catch (err: any) {
      throw err;
    }
  });

  app.put("/api/user-project-folder/:projectName", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const projectName = decodeURIComponent(paramStr(req.params.projectName));
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
      throw err;
    }
  });

  app.delete("/api/user-project-folder/:projectName", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const projectName = decodeURIComponent(paramStr(req.params.projectName));

      await db.delete(userProjectFolders)
        .where(and(
          eq(userProjectFolders.userId, userId),
          eq(userProjectFolders.projectName, projectName)
        ));
      logAuditFromReq(req, { entityType: "user_project_folder", action: "delete", projectName });
      res.json({ success: true });
    } catch (err: any) {
      throw err;
    }
  });

  // ==================== GLOBAL ERROR HANDLER ====================

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, err);
  });
}
