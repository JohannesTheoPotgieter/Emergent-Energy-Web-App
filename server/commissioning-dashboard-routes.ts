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
import { eq, and, desc } from "drizzle-orm";
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
      console.error("[CommissioningDashboard] Error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Failed to fetch commissioning dashboard" });
    }
  });

  /** POST /api/commissioning-dashboard/:projectId/refresh — re-parse workbook from source */
  app.post("/api/commissioning-dashboard/:projectId/refresh", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), async (req: Request, res: Response) => {
    try {
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
      console.error("[CommissioningDashboard] Refresh error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Failed to refresh commissioning data" });
    }
  });

  /** GET /api/commissioning-dashboard/:projectId/source */
  app.get("/api/commissioning-dashboard/:projectId/source", jwtAuth, requireAuth, requirePermission("commissioning", "view"), async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });
      const [source] = await db.select()
        .from(commissioningSources)
        .where(and(eq(commissioningSources.projectId, projectId), eq(commissioningSources.isActive, true)));
      res.json(source || null);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch source config" });
    }
  });

  /** PUT /api/commissioning-dashboard/:projectId/source */
  app.put("/api/commissioning-dashboard/:projectId/source", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), async (req: Request, res: Response) => {
    try {
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
      console.error("[CommissioningDashboard] Source update error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Failed to update source config" });
    }
  });

  /** POST /api/commissioning-dashboard/:projectId/upload — manual workbook upload */
  app.post("/api/commissioning-dashboard/:projectId/upload", jwtAuth, requireAuth, requirePermission("commissioning", "edit"), workbookUpload.single("file"), async (req: Request, res: Response) => {
    try {
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
      console.error("[CommissioningDashboard] Upload error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Failed to process uploaded workbook" });
    }
  });
}
