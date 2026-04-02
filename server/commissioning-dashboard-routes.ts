/**
 * Commissioning Dashboard Routes
 *
 * Workbook-driven commissioning control tower API.
 * All routes are project-scoped (/api/commissioning-dashboard/:projectId/...).
 */
import { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { projectInfo } from "@shared/schema";
import {
  commissioningSources,
  commissioningSnapshots,
  type CommissioningDashboardPayload,
  type CommissioningSection,
} from "@shared/schema/commissioning-source";
import { requirePermission } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import {
  parseCommissioningWorkbook,
  calculateBlockers,
  calculateOverallStatus,
  calculateCompletionPercent,
} from "./services/commissioning-workbook-parser";

// Multer for manual upload — memory storage, workbook files only
const WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xlsm"]);
const workbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (WORKBOOK_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Only .xlsx and .xlsm files are accepted, got ${ext}`));
    }
  },
});

const COMMISSIONING_MIGRATION_HINT = "Run migration: migrations/20260401_commissioning_workbook_source.sql";

let commissioningSchemaReady: Promise<void> | null = null;

function toErrorDetails(err: unknown): { message: string; code?: string; detail?: string } {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    return {
      message: anyErr.message ? String(anyErr.message) : "Unknown error",
      code: anyErr.code ? String(anyErr.code) : undefined,
      detail: anyErr.detail ? String(anyErr.detail) : undefined,
    };
  }
  return { message: String(err ?? "Unknown error") };
}

function isCommissioningSchemaMissingError(err: unknown): boolean {
  const details = toErrorDetails(err);
  return details.code === "42P01" || details.code === "42703" || details.message.toLowerCase().includes("commissioning_sources") || details.message.toLowerCase().includes("commissioning_snapshots");
}

async function ensureCommissioningDashboardSchema(): Promise<void> {
  if (!commissioningSchemaReady) {
    commissioningSchemaReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS commissioning_sources (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES project_info(id),
          source_type TEXT NOT NULL DEFAULT 'sharepoint',
          source_format TEXT NOT NULL DEFAULT 'commissioning_workbook',
          drive_id TEXT,
          item_id TEXT,
          file_path TEXT,
          workbook_url TEXT,
          folder_url TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by INTEGER REFERENCES users(id),
          UNIQUE(project_id)
        );
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS commissioning_snapshots (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES project_info(id),
          source_id INTEGER REFERENCES commissioning_sources(id),
          source_etag TEXT,
          source_ctag TEXT,
          source_modified_at TIMESTAMP,
          parse_status TEXT NOT NULL DEFAULT 'pending',
          parse_message TEXT,
          parsed_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
          parsed_at TIMESTAMP NOT NULL DEFAULT NOW(),
          is_latest BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_commissioning_snapshots_project ON commissioning_snapshots(project_id, is_latest);`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_commissioning_sources_project ON commissioning_sources(project_id);`);
      await db.execute(sql`ALTER TABLE commissioning_sources ADD COLUMN IF NOT EXISTS source_format TEXT NOT NULL DEFAULT 'commissioning_workbook';`);
      await db.execute(sql`ALTER TABLE commissioning_snapshots ADD COLUMN IF NOT EXISTS parsed_sections JSONB NOT NULL DEFAULT '[]'::jsonb;`);
    })().catch((err) => {
      commissioningSchemaReady = null;
      throw err;
    });
  }

  await commissioningSchemaReady;
}

function respondCommissioningError(
  res: Response,
  routeLabel: string,
  err: unknown,
  fallbackMessage: string,
) {
  const details = toErrorDetails(err);
  console.error(`[CommissioningDashboard] ${routeLabel} failed`, {
    message: details.message,
    code: details.code,
    detail: details.detail,
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (isCommissioningSchemaMissingError(err)) {
    return res.status(503).json({
      error: "Commissioning dashboard schema is not available in this environment",
      code: "COMMISSIONING_SCHEMA_MISSING",
      detail: details.detail || details.message,
      migration: COMMISSIONING_MIGRATION_HINT,
    });
  }

  return res.status(500).json({
    error: fallbackMessage,
    code: details.code || "COMMISSIONING_DASHBOARD_ERROR",
    detail: details.detail || details.message,
  });
}

function workbookUploadSingle(req: Request, res: Response, next: (err?: unknown) => void) {
  workbookUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const details = toErrorDetails(err);
    console.error("[CommissioningDashboard] Upload validation failed", details);
    res.status(400).json({
      error: "Invalid workbook upload",
      code: "UPLOAD_VALIDATION_ERROR",
      detail: details.message,
    });
  });
}

async function tryDownloadFromSharePoint(driveId: string, itemId: string): Promise<{
  buffer: Buffer; etag: string; ctag: string; modifiedAt: string | null;
} | null> {
  try {
    const { downloadFileContent, getFileMetadata } = await import("./sharepoint");
    const meta = await getFileMetadata(driveId, itemId);
    const buffer = await downloadFileContent(driveId, itemId);
    return {
      buffer,
      etag: meta.eTag || "",
      ctag: meta.cTag || "",
      modifiedAt: meta.lastModifiedDateTime || null,
    };
  } catch (err) {
    console.error("[CommissioningDashboard] SharePoint download failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function registerCommissioningDashboardRoutes(app: Express): void {

  /** GET /api/commissioning-dashboard/:projectId — main dashboard payload */
  app.get("/api/commissioning-dashboard/:projectId", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      await ensureCommissioningDashboardSchema();
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const [project] = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo)
        .where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      const [source] = await db.select()
        .from(commissioningSources)
        .where(and(eq(commissioningSources.projectId, projectId), eq(commissioningSources.isActive, true)));

      const [snapshot] = await db.select()
        .from(commissioningSnapshots)
        .where(and(eq(commissioningSnapshots.projectId, projectId), eq(commissioningSnapshots.isLatest, true)))
        .orderBy(desc(commissioningSnapshots.parsedAt))
        .limit(1);

      // The parsedSections JSONB stores { sections, projectInfo, omHandoverChecklist, ssegStatus, finalCompletionCrossCheck }
      const stored = (snapshot?.parsedSections || {}) as any;
      const sections: CommissioningSection[] = stored.sections || [];
      const storedProjectInfo = stored.projectInfo || {};
      const storedOmChecklist = stored.omHandoverChecklist || [];
      const storedSseg = stored.ssegStatus || {};

      const blockers = calculateBlockers(sections);
      const overallStatus = calculateOverallStatus(sections);
      const completionPercent = calculateCompletionPercent(sections);

      const isStale = snapshot?.parsedAt
        ? (Date.now() - new Date(snapshot.parsedAt).getTime()) > 24 * 60 * 60 * 1000
        : true;

      const payload: CommissioningDashboardPayload = {
        projectId,
        projectName: project.projectName,
        source: source || null,
        snapshot: snapshot || null,
        projectInfo: storedProjectInfo,
        sections,
        overallStatus,
        completionPercent,
        blockers,
        ssegStatus: storedSseg,
        omHandoverChecklist: storedOmChecklist,
        syncState: {
          lastRefreshed: snapshot?.parsedAt ? new Date(snapshot.parsedAt).toISOString() : null,
          parseStatus: snapshot?.parseStatus || null,
          parseMessage: snapshot?.parseMessage || null,
          isStale,
        },
      };

      res.json(payload);
    } catch (err) {
      return respondCommissioningError(res, "GET /api/commissioning-dashboard/:projectId", err, "Failed to fetch commissioning dashboard");
    }
  });

  /** POST /api/commissioning-dashboard/:projectId/refresh — re-parse workbook from source */
  app.post("/api/commissioning-dashboard/:projectId/refresh", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), async (req: Request, res: Response) => {
    try {
      await ensureCommissioningDashboardSchema();
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const [source] = await db.select()
        .from(commissioningSources)
        .where(and(eq(commissioningSources.projectId, projectId), eq(commissioningSources.isActive, true)));

      if (!source) {
        return res.status(404).json({ error: "No commissioning source configured for this project" });
      }

      let buffer: Buffer | null = null;
      let etag = "";
      let ctag = "";
      let modifiedAt: string | null = null;

      if (source.sourceType === "sharepoint" && source.driveId && source.itemId) {
        const result = await tryDownloadFromSharePoint(source.driveId, source.itemId);
        if (result) {
          buffer = result.buffer;
          etag = result.etag;
          ctag = result.ctag;
          modifiedAt = result.modifiedAt;
        }
      }

      if (!buffer) {
        const [lastGood] = await db.select()
          .from(commissioningSnapshots)
          .where(and(
            eq(commissioningSnapshots.projectId, projectId),
            eq(commissioningSnapshots.parseStatus, "success"),
          ))
          .orderBy(desc(commissioningSnapshots.parsedAt))
          .limit(1);

        return res.status(200).json({
          refreshed: false,
          warning: "Could not download workbook from source. Showing last good snapshot.",
          snapshot: lastGood || null,
        });
      }

      // Skip re-parse if content unchanged
      if (ctag) {
        const [existing] = await db.select()
          .from(commissioningSnapshots)
          .where(and(
            eq(commissioningSnapshots.projectId, projectId),
            eq(commissioningSnapshots.isLatest, true),
          ))
          .limit(1);

        if (existing?.sourceCtag === ctag) {
          return res.status(200).json({
            refreshed: false,
            message: "Workbook unchanged since last parse",
            snapshot: existing,
          });
        }
      }

      const parseResult = await parseCommissioningWorkbook(buffer, source.sourceFormat || "commissioning_workbook");

      // Rotate snapshots
      await db.update(commissioningSnapshots)
        .set({ isLatest: false })
        .where(and(eq(commissioningSnapshots.projectId, projectId), eq(commissioningSnapshots.isLatest, true)));

      // Store sections + metadata together in parsed_sections JSONB
      const snapshotPayload = {
        sections: parseResult.sections,
        projectInfo: parseResult.projectInfo,
        omHandoverChecklist: parseResult.omHandoverChecklist,
        ssegStatus: parseResult.ssegStatus,
        finalCompletionCrossCheck: parseResult.finalCompletionCrossCheck,
      };

      const [newSnapshot] = await db.insert(commissioningSnapshots).values({
        projectId,
        sourceId: source.id,
        sourceEtag: etag || null,
        sourceCtag: ctag || null,
        sourceModifiedAt: modifiedAt ? new Date(modifiedAt) : null,
        parseStatus: parseResult.parseStatus,
        parseMessage: parseResult.parseMessage,
        parsedSections: snapshotPayload as any,
        parsedAt: new Date(),
        isLatest: true,
      }).returning();

      logAuditFromReq(req, {
        entityType: "commissioning_snapshot",
        entityId: String(newSnapshot.id),
        action: "refresh",
        changesJson: {
          parseStatus: parseResult.parseStatus,
          sectionCount: parseResult.sections.length,
          warnings: parseResult.warnings,
        },
      });

      res.json({ refreshed: true, snapshot: newSnapshot, warnings: parseResult.warnings });
    } catch (err) {
      return respondCommissioningError(res, "POST /api/commissioning-dashboard/:projectId/refresh", err, "Failed to refresh commissioning data");
    }
  });

  /** GET /api/commissioning-dashboard/:projectId/source */
  app.get("/api/commissioning-dashboard/:projectId/source", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      await ensureCommissioningDashboardSchema();
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      const [source] = await db.select()
        .from(commissioningSources)
        .where(and(eq(commissioningSources.projectId, projectId), eq(commissioningSources.isActive, true)));
      res.json(source || null);
    } catch (err) {
      return respondCommissioningError(res, "GET /api/commissioning-dashboard/:projectId/source", err, "Failed to fetch source config");
    }
  });

  /** PUT /api/commissioning-dashboard/:projectId/source */
  app.put("/api/commissioning-dashboard/:projectId/source", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), async (req: Request, res: Response) => {
    try {
      await ensureCommissioningDashboardSchema();
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      const user = getEffectiveUser(req);
      const { sourceType, sourceFormat, driveId, itemId, filePath, workbookUrl, folderUrl } = req.body;

      const [existing] = await db.select()
        .from(commissioningSources)
        .where(eq(commissioningSources.projectId, projectId));

      let result;
      if (existing) {
        [result] = await db.update(commissioningSources)
          .set({
            sourceType: sourceType || existing.sourceType,
            sourceFormat: sourceFormat || existing.sourceFormat,
            driveId: driveId !== undefined ? driveId : existing.driveId,
            itemId: itemId !== undefined ? itemId : existing.itemId,
            filePath: filePath !== undefined ? filePath : existing.filePath,
            workbookUrl: workbookUrl !== undefined ? workbookUrl : existing.workbookUrl,
            folderUrl: folderUrl !== undefined ? folderUrl : existing.folderUrl,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(commissioningSources.id, existing.id))
          .returning();
      } else {
        [result] = await db.insert(commissioningSources).values({
          projectId,
          sourceType: sourceType || "sharepoint",
          sourceFormat: sourceFormat || "commissioning_workbook",
          driveId: driveId || null,
          itemId: itemId || null,
          filePath: filePath || null,
          workbookUrl: workbookUrl || null,
          folderUrl: folderUrl || null,
          isActive: true,
          createdBy: user?.id || null,
        }).returning();
      }

      logAuditFromReq(req, {
        entityType: "commissioning_source",
        entityId: String(result.id),
        action: existing ? "update" : "create",
        changesJson: { sourceType: result.sourceType, sourceFormat: result.sourceFormat },
      });

      res.json(result);
    } catch (err) {
      return respondCommissioningError(res, "PUT /api/commissioning-dashboard/:projectId/source", err, "Failed to update source config");
    }
  });

  /** POST /api/commissioning-dashboard/:projectId/upload — manual workbook upload */
  app.post("/api/commissioning-dashboard/:projectId/upload", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), workbookUploadSingle, async (req: Request, res: Response) => {
    try {
      await ensureCommissioningDashboardSchema();
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded. Send multipart/form-data with field 'file'." });

      const buffer = req.file.buffer;
      const fileName = req.file.originalname;

      // Determine source format from existing source config or default
      const [source] = await db.select()
        .from(commissioningSources)
        .where(and(eq(commissioningSources.projectId, projectId), eq(commissioningSources.isActive, true)));
      const sourceFormat = source?.sourceFormat || "commissioning_workbook";

      const parseResult = await parseCommissioningWorkbook(buffer, sourceFormat);
      if (parseResult.parseStatus === "failed") {
        return res.status(422).json({
          error: "Workbook validation failed",
          code: "WORKBOOK_VALIDATION_FAILED",
          parseMessage: parseResult.parseMessage,
          warnings: parseResult.warnings,
        });
      }

      // Rotate snapshots
      await db.update(commissioningSnapshots)
        .set({ isLatest: false })
        .where(and(eq(commissioningSnapshots.projectId, projectId), eq(commissioningSnapshots.isLatest, true)));

      const snapshotPayload = {
        sections: parseResult.sections,
        projectInfo: parseResult.projectInfo,
        omHandoverChecklist: parseResult.omHandoverChecklist,
        ssegStatus: parseResult.ssegStatus,
        finalCompletionCrossCheck: parseResult.finalCompletionCrossCheck,
      };

      const [newSnapshot] = await db.insert(commissioningSnapshots).values({
        projectId,
        sourceId: source?.id || null,
        parseStatus: parseResult.parseStatus,
        parseMessage: `Manual upload: ${fileName}. ${parseResult.parseMessage}`,
        parsedSections: snapshotPayload as any,
        parsedAt: new Date(),
        isLatest: true,
      }).returning();

      logAuditFromReq(req, {
        entityType: "commissioning_snapshot",
        entityId: String(newSnapshot.id),
        action: "manual_upload",
        changesJson: { fileName, parseStatus: parseResult.parseStatus, sectionCount: parseResult.sections.length },
      });

      res.json({ refreshed: true, snapshot: newSnapshot, warnings: parseResult.warnings });
    } catch (err) {
      return respondCommissioningError(res, "POST /api/commissioning-dashboard/:projectId/upload", err, "Failed to process uploaded workbook");
    }
  });
}
