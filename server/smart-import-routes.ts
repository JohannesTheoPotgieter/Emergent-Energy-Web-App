// Smart Import API Routes
// Register in server/index.ts: import { registerSmartImportRoutes } from "./smart-import-routes"; registerSmartImportRoutes(app);

import { Express, Request, Response, NextFunction, Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "./db";
import { verifyToken } from "./jwt";
import { runSmartImportPreview } from "./lib/import/index";
import {
  smartImportRuns,
  importIssues,
  normalizedPlanTasks,
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedExecutionPhases,
  counterparties,
  mappingRules,
  templateProfiles,
  issueResolutionRules,
  invoicePatternRules,
  invoicePatternMatches,
  projectInfo,
  changeSets,
} from "@shared/schema";
import { recordImportChange, recordSystemEvent } from "./lib/audit/diff-engine";
import { eq, desc, and, sql, inArray } from "drizzle-orm";

function extractProjectNameFromFilename(fileName: string): string {
  let name = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const trackerIdx = name.toLowerCase().indexOf("tracker");
  if (trackerIdx > 0) {
    name = name.substring(0, trackerIdx);
  }
  name = name.replace(/[_\-]+/g, " ").replace(/[^a-zA-Z0-9\s]/g, "").trim();
  name = name.replace(/\s+/g, " ");
  return name || "Untitled Project";
}

const router = Router();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
      cb(null, `${timestamp}_${sanitized}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
      "application/vnd.ms-excel",
    ];
    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xlsm") ||
      file.originalname.endsWith(".xls")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only Excel files (.xlsx, .xlsm, .xls) are allowed."));
    }
  },
});

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

router.use(jwtAuth);

// POST /api/smart-import/upload
router.post("/api/smart-import/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;

    const buffer = fs.readFileSync(filePath);

    console.log(`[SmartImport] Processing file: ${fileName} (${buffer.length} bytes)`);

    const preview = await runSmartImportPreview(buffer, fileName);
    
    console.log(`[SmartImport] Detection: ${preview.detection.sections.length} sections, ${preview.detection.unmatched.length} unmatched`);

    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const projectName = extractProjectNameFromFilename(fileName);

    if (preview.detection.projectInfo) {
      if (!preview.detection.projectInfo.name) {
        preview.detection.projectInfo.name = projectName;
      }
    } else {
      preview.detection.projectInfo = {
        name: projectName,
        sizeKwp: null, pd: null, pm: null, contractValue: null, phase: null,
        pdHandoverDate: null, constructionStartDate: null, commissioningDate: null,
        omHandoverDate: null, clientHandoverDate: null,
      };
    }

    const userId = (req as any).user?.id || null;

    const [run] = await db
      .insert(smartImportRuns)
      .values({
        projectId: projectId,
        projectName,
        uploadedBy: userId,
        sourceFileName: fileName,
        sourceFileHash: fileHash,
        status: "PREVIEW",
        summaryJson: preview as any,
      })
      .returning();

    if (preview.normalization.issues.length > 0) {
      const activeRules = await db.select().from(issueResolutionRules)
        .where(and(
          eq(issueResolutionRules.active, true),
          eq(issueResolutionRules.projectName, projectName),
        ));

      const ruleMap = new Map<string, typeof activeRules[0]>();
      for (const rule of activeRules) {
        ruleMap.set(`${rule.issueType}::${rule.fingerprint}::${rule.section}`, rule);
      }

      const issueValues = preview.normalization.issues.map((issue: any) => {
        const fingerprint = issue.issueFingerprint || null;
        const issueType = issue.issueType || null;
        const lookupKey = `${issueType}::${fingerprint}::${issue.section}`;
        const matchedRule = fingerprint ? ruleMap.get(lookupKey) : undefined;

        return {
          importRunId: run.id,
          severity: issue.severity as any,
          section: issue.section as any,
          message: issue.message,
          suggestedAction: issue.suggestedAction,
          issueType,
          issueFingerprint: fingerprint,
          resolved: matchedRule?.applyAlways ? true : false,
          resolution: matchedRule?.applyAlways ? matchedRule.resolution : null,
          resolutionNote: matchedRule?.applyAlways ? matchedRule.resolutionNote : null,
          autoResolved: matchedRule?.applyAlways ? true : false,
          matchedRuleId: matchedRule?.id || null,
          overrideData: matchedRule?.applyAlways && matchedRule.overrideData ? matchedRule.overrideData : null,
          payloadJson: issue.payloadJson || null,
        };
      });
      await db.insert(importIssues).values(issueValues);

      const autoAppliedRuleIds = Array.from(new Set(
        issueValues.filter(v => v.autoResolved && v.matchedRuleId).map(v => v.matchedRuleId!)
      ));
      for (const ruleId of autoAppliedRuleIds) {
        await db.update(issueResolutionRules)
          .set({
            timesApplied: sql`${issueResolutionRules.timesApplied} + 1`,
            lastAppliedAt: new Date(),
          })
          .where(eq(issueResolutionRules.id, ruleId));
      }
    }

    res.json({ runId: run.id, preview });
  } catch (err: any) {
    console.error("[smart-import] POST upload error:", err);
    let userMessage = err.message || "Unknown error";
    if (userMessage.includes("End of data reached") || userMessage.includes("Unexpected EOF") || userMessage.includes("Invalid signature")) {
      userMessage = "The file appears to be corrupted or is not a valid Excel file. Please open it in Excel, save as a new .xlsx file, and try again.";
    } else if (userMessage.includes("encrypted") || userMessage.includes("password")) {
      userMessage = "The file is password-protected. Please remove the password in Excel and re-upload.";
    } else if (userMessage.includes("ENOMEM") || userMessage.includes("heap")) {
      userMessage = "The file is too large to process. Try splitting it into smaller files or removing unused sheets.";
    } else if (userMessage.includes("ENOENT")) {
      userMessage = "The uploaded file could not be found on the server. Please try uploading again.";
    }
    res.status(500).json({ error: userMessage });
  }
});

// GET /api/smart-import/history/:projectName
router.get("/api/smart-import/history/:projectName", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const runs = await db
      .select()
      .from(smartImportRuns)
      .where(eq(smartImportRuns.projectName, projectName))
      .orderBy(desc(smartImportRuns.uploadedAt));

    res.json(runs);
  } catch (err: any) {
    console.error("[smart-import] GET history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/pending-runs (must be BEFORE :runId to avoid route conflict)
router.get("/api/smart-import/pending-runs", requireAuth, async (_req: Request, res: Response) => {
  try {
    const runs = await db
      .select({
        id: smartImportRuns.id,
        projectName: smartImportRuns.projectName,
        status: smartImportRuns.status,
        uploadedAt: smartImportRuns.uploadedAt,
        sourceFileName: smartImportRuns.sourceFileName,
      })
      .from(smartImportRuns)
      .where(eq(smartImportRuns.status, "PREVIEW"))
      .orderBy(smartImportRuns.projectName);

    const latestByProject = new Map<string, typeof runs[0]>();
    const duplicateIds: number[] = [];
    for (const run of runs) {
      const key = `${run.projectName}::${run.sourceFileName}`;
      const existing = latestByProject.get(key);
      if (!existing) {
        latestByProject.set(key, run);
      } else {
        const existingTime = new Date(existing.uploadedAt!).getTime();
        const currentTime = new Date(run.uploadedAt!).getTime();
        if (currentTime > existingTime) {
          duplicateIds.push(existing.id);
          latestByProject.set(key, run);
        } else {
          duplicateIds.push(run.id);
        }
      }
    }

    if (duplicateIds.length > 0) {
      for (const dupId of duplicateIds) {
        await db.update(smartImportRuns)
          .set({ status: "SUPERSEDED" })
          .where(eq(smartImportRuns.id, dupId));
      }
      console.log(`[smart-import] Marked ${duplicateIds.length} duplicate PREVIEW runs as SUPERSEDED`);
    }

    const dedupedRuns = Array.from(latestByProject.values());

    const runsWithIssues = await Promise.all(dedupedRuns.map(async (run: any) => {
      const issues = await db.select().from(importIssues)
        .where(eq(importIssues.importRunId, run.id));
      const blockers = issues.filter((i: any) => i.severity === "BLOCKER" && !i.resolved);
      const warnings = issues.filter((i: any) => i.severity !== "BLOCKER" && !i.resolved);
      const totalIssues = issues.length;
      const resolvedIssues = issues.filter((i: any) => i.resolved).length;
      return {
        ...run,
        blockerCount: blockers.length,
        warningCount: warnings.length,
        totalIssues,
        resolvedIssues,
      };
    }));

    runsWithIssues.sort((a, b) => a.projectName.localeCompare(b.projectName));
    res.json(runsWithIssues);
  } catch (err: any) {
    console.error("[smart-import] GET pending-runs error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/:runId
router.get("/api/smart-import/:runId", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const issues = await db.select().from(importIssues).where(eq(importIssues.importRunId, runId));

    res.json({
      run,
      issues,
      preview: run.summaryJson,
    });
  } catch (err: any) {
    console.error("[smart-import] GET run error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/project-info
router.patch("/api/smart-import/:runId/project-info", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    const updates = req.body as Record<string, string | null>;

    if (!summary.detection) summary.detection = {};
    if (!summary.detection.projectInfo) {
      summary.detection.projectInfo = {
        name: null, sizeKwp: null, pd: null, pm: null, contractValue: null, phase: null,
        pdHandoverDate: null, constructionStartDate: null, commissioningDate: null,
        omHandoverDate: null, clientHandoverDate: null,
      };
    }

    for (const [key, value] of Object.entries(updates)) {
      if (key in summary.detection.projectInfo) {
        (summary.detection.projectInfo as any)[key] = value;
      }
    }

    const updateFields: any = { summaryJson: summary };
    if ("name" in updates) {
      updateFields.projectName = updates.name || run.sourceFileName?.replace(/\.(xlsx|xlsm|xls)$/i, "") || "Untitled";
    }
    await db.update(smartImportRuns).set(updateFields).where(eq(smartImportRuns.id, runId));

    res.json({ success: true, projectInfo: summary.detection.projectInfo });
  } catch (err: any) {
    console.error("[smart-import] PATCH project-info error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/mapping
router.patch("/api/smart-import/:runId/mapping", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const { section, colIndex, canonicalField } = req.body;
    if (!section || colIndex == null || !canonicalField) {
      return res.status(400).json({ error: "section, colIndex, and canonicalField are required" });
    }

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    if (summary && summary.mappings) {
      const sectionMapping = summary.mappings.find((m: any) => m.section === section);
      if (sectionMapping && sectionMapping.mappings) {
        const existing = sectionMapping.mappings.find((m: any) => m.colIndex === colIndex);
        if (existing) {
          existing.canonicalField = canonicalField;
          existing.confidence = 1.0;
          existing.source = "USER_OVERRIDE";
        } else {
          sectionMapping.mappings.push({
            colIndex,
            canonicalField,
            confidence: 1.0,
            source: "USER_OVERRIDE",
          });
        }
      }

      await db
        .update(smartImportRuns)
        .set({ summaryJson: summary })
        .where(eq(smartImportRuns.id, runId));
    }

    const sourceHeader = (() => {
      if (summary && summary.mappings) {
        const sectionMapping = summary.mappings.find((m: any) => m.section === section);
        if (sectionMapping && sectionMapping.mappings) {
          const col = sectionMapping.mappings.find((m: any) => m.colIndex === colIndex);
          if (col) return col.rawHeader || col.excelHeader || null;
        }
      }
      if (summary && summary.sections) {
        const sec = summary.sections.find((s: any) => (s.section || s.name) === section);
        if (sec) {
          const cols = sec.columnMappings || sec.columns || [];
          const col = cols.find((c: any) => (c.colIndex ?? c.index) === colIndex);
          if (col) return col.excelHeader || col.header || col.rawHeader || null;
        }
      }
      return null;
    })();

    if (sourceHeader) {
      try {
        const filePattern = run.sourceFileName
          .replace(/^\d+_/, "")
          .replace(/\.(xlsx|xlsm|xls)$/i, "")
          .replace(/_/g, " ")
          .trim();

        const profileName = filePattern || run.projectName || "Default Template";

        const existingProfiles = await db
          .select()
          .from(templateProfiles)
          .where(eq(templateProfiles.name, profileName))
          .limit(1);

        let profileId: number;
        if (existingProfiles.length > 0) {
          profileId = existingProfiles[0].id;
        } else {
          const userId = (req as any).user?.id || null;
          const [newProfile] = await db
            .insert(templateProfiles)
            .values({
              name: profileName,
              isDefault: false,
              createdBy: userId,
            })
            .returning();
          profileId = newProfile.id;
        }

        const existingRules = await db
          .select()
          .from(mappingRules)
          .where(
            and(
              eq(mappingRules.templateProfileId, profileId),
              eq(mappingRules.section, section as any),
              eq(mappingRules.sourceHeader, sourceHeader)
            )
          )
          .limit(1);

        if (existingRules.length > 0) {
          await db
            .update(mappingRules)
            .set({
              canonicalField: canonicalField,
              confidenceWeight: 1.0,
            })
            .where(eq(mappingRules.id, existingRules[0].id));
        } else {
          await db
            .insert(mappingRules)
            .values({
              templateProfileId: profileId,
              section: section as any,
              sourceHeader: sourceHeader,
              canonicalField: canonicalField,
              confidenceWeight: 1.0,
            });
        }
      } catch (learnErr: any) {
        console.warn("[smart-import] Failed to persist learned mapping:", learnErr.message);
      }
    }

    res.json({ success: true, updatedMapping: { section, colIndex, canonicalField } });
  } catch (err: any) {
    console.error("[smart-import] PATCH mapping error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/issue/:issueId/resolve
router.patch("/api/smart-import/:runId/issue/:issueId/resolve", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    const issueId = parseInt(req.params.issueId as string);
    if (isNaN(runId) || isNaN(issueId)) return res.status(400).json({ error: "Invalid runId or issueId" });

    const { resolved, resolution, resolutionNote, rememberDecision, overrideData } = req.body;
    if (resolved === undefined) return res.status(400).json({ error: "resolved field is required" });

    const userId = (req as any).user?.id || null;
    const resType = resolved ? (resolution || "ACCEPTED") : null;

    const [updated] = await db
      .update(importIssues)
      .set({
        resolved: !!resolved,
        resolution: resType,
        resolutionNote: resolved ? (resolutionNote || null) : null,
        resolvedBy: resolved ? userId : null,
        resolvedAt: resolved ? new Date() : null,
        overrideData: resType === "OVERRIDE" && overrideData ? overrideData : null,
      })
      .where(and(eq(importIssues.id, issueId), eq(importIssues.importRunId, runId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Issue not found" });

    if (resolved && rememberDecision !== false && updated.issueType && updated.issueFingerprint) {
      const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
      const projectName = run?.projectName || null;

      const existing = await db.select().from(issueResolutionRules)
        .where(and(
          eq(issueResolutionRules.issueType, updated.issueType),
          eq(issueResolutionRules.fingerprint, updated.issueFingerprint),
          eq(issueResolutionRules.section, updated.section),
          eq(issueResolutionRules.active, true),
        ));

      const resValue = resolution || "ACCEPTED";
      const ovData = resValue === "OVERRIDE" && overrideData ? overrideData : null;
      if (existing.length === 0) {
        await db.insert(issueResolutionRules).values({
          projectName,
          issueType: updated.issueType,
          fingerprint: updated.issueFingerprint,
          section: updated.section,
          resolution: resValue,
          resolutionNote: resolutionNote || null,
          overrideData: ovData,
          applyAlways: !!rememberDecision,
          timesApplied: 1,
          createdBy: userId,
        });
      } else {
        await db.update(issueResolutionRules)
          .set({
            timesApplied: sql`${issueResolutionRules.timesApplied} + 1`,
            lastAppliedAt: new Date(),
            resolution: resValue,
            resolutionNote: resolutionNote || null,
            overrideData: ovData,
          })
          .where(eq(issueResolutionRules.id, existing[0].id));
      }
    }

    res.json(updated);
  } catch (err: any) {
    console.error("[smart-import] PATCH resolve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/ignore-all-blockers
router.post("/api/smart-import/:runId/ignore-all-blockers", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    let userRole = (req as any).user?.role;
    if (userRole === "admin") userRole = "COO_ADMIN";
    const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN"];
    if (!userRole || !ADMIN_ROLES.includes(userRole)) {
      return res.status(403).json({ error: "Only admin users can ignore all blockers" });
    }

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const userId = (req as any).user?.id || null;
    const allIssues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    const unresolvedBlockers = allIssues.filter((i: any) =>
      (i.severity === "BLOCKER" || i.severity === "blocker" || i.severity === "error") && !i.resolved
    );

    let ignored = 0;
    for (const blocker of unresolvedBlockers) {
      await db.update(importIssues)
        .set({
          resolved: true,
          resolution: "IGNORED",
          resolutionNote: "Bulk-ignored by admin",
          resolvedBy: userId,
          resolvedAt: new Date(),
        })
        .where(eq(importIssues.id, blocker.id));
      ignored++;
    }

    const updatedIssues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    res.json({ ignored, issues: updatedIssues });
  } catch (err: any) {
    console.error("[smart-import] POST ignore-all-blockers error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/apply-prior-resolutions
router.post("/api/smart-import/:runId/apply-prior-resolutions", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const userId = (req as any).user?.id || null;

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const issues = await db.select().from(importIssues)
      .where(and(eq(importIssues.importRunId, runId), eq(importIssues.resolved, false)));

    const activeRules = await db.select().from(issueResolutionRules)
      .where(and(
        eq(issueResolutionRules.active, true),
        eq(issueResolutionRules.projectName, run.projectName),
      ));

    const ruleMap = new Map<string, typeof activeRules[0]>();
    for (const rule of activeRules) {
      ruleMap.set(`${rule.issueType}::${rule.fingerprint}::${rule.section}`, rule);
    }

    let applied = 0;
    for (const issue of issues) {
      if (!issue.issueType || !issue.issueFingerprint) continue;
      const lookupKey = `${issue.issueType}::${issue.issueFingerprint}::${issue.section}`;
      const rule = ruleMap.get(lookupKey);
      if (!rule) continue;

      await db.update(importIssues)
        .set({
          resolved: true,
          resolution: rule.resolution,
          resolutionNote: rule.resolutionNote,
          resolvedBy: userId,
          resolvedAt: new Date(),
          autoResolved: true,
          matchedRuleId: rule.id,
        })
        .where(eq(importIssues.id, issue.id));

      await db.update(issueResolutionRules)
        .set({
          timesApplied: sql`${issueResolutionRules.timesApplied} + 1`,
          lastAppliedAt: new Date(),
        })
        .where(eq(issueResolutionRules.id, rule.id));

      applied++;
    }

    const updatedIssues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    res.json({ applied, issues: updatedIssues });
  } catch (err: any) {
    console.error("[smart-import] POST apply-prior-resolutions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/commit
router.post("/api/smart-import/:runId/commit", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status === "COMMITTED") {
      return res.status(400).json({ error: "This import has already been committed" });
    }

    // Import recency enforcement
    const lastCommitted = await db
      .select()
      .from(smartImportRuns)
      .where(and(
        eq(smartImportRuns.projectName, run.projectName),
        eq(smartImportRuns.status, "COMMITTED")
      ))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (lastCommitted.length > 0) {
      const lastDate = lastCommitted[0].committedAt;
      const currentDate = run.uploadedAt;
      if (lastDate && currentDate) {
        const lastTs = new Date(lastDate).getTime();
        const currentTs = new Date(currentDate).getTime();
        const forceCommit = req.body?.forceCommit === true;
        const ackEqualDate = req.body?.acknowledgeEqualDate === true;

        if (currentTs < lastTs && !forceCommit) {
          return res.status(409).json({
            error: "import_older_than_existing",
            message: "This import file is older than the last committed import. Newer imports take precedence.",
            lastCommittedAt: lastDate,
            currentUploadedAt: currentDate,
            hint: "Upload a newer file or set forceCommit=true to override.",
          });
        }

        if (Math.abs(currentTs - lastTs) < 60000 && !ackEqualDate) {
          return res.status(409).json({
            error: "import_equal_date",
            message: "This import has a similar timestamp to the last committed import. Please review for conflicts.",
            lastCommittedAt: lastDate,
            currentUploadedAt: currentDate,
            requiresReview: true,
            hint: "Set acknowledgeEqualDate=true after reviewing conflicts.",
          });
        }
      }
    }

    const acknowledgeManualEdits = req.body?.acknowledgeManualEdits === true;
    if (!acknowledgeManualEdits && run.projectId) {
      const manualEditCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(changeSets)
        .where(and(
          eq(changeSets.projectId, run.projectId),
          eq(changeSets.entityType, "expense_line"),
          eq(changeSets.source, "MANUAL_EDIT")
        ));
      const editCount = Number(manualEditCount[0]?.count || 0);
      if (editCount > 0) {
        return res.status(409).json({
          error: "manual_edits_warning",
          message: `This project has ${editCount} manually edited expenditure record(s). Re-importing will overwrite these changes.`,
          manualEditCount: editCount,
          hint: "Set acknowledgeManualEdits=true to proceed, or review edits in the Change Audit first.",
        });
      }
    }

    const issues = await db
      .select()
      .from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    const unresolvedBlockers = issues.filter((i: any) => i.severity === "BLOCKER" && !i.resolved);
    if (unresolvedBlockers.length > 0) {
      return res.status(400).json({
        error: "Unresolved blocker issues must be resolved before committing",
        unresolvedBlockers: unresolvedBlockers.map((b: any) => ({ id: b.id, message: b.message, section: b.section })),
      });
    }

    const summary = run.summaryJson as any;
    if (!summary || !summary.normalization) {
      return res.status(400).json({ error: "No normalization data found in this import run" });
    }

    const norm = summary.normalization;
    const projectName = run.projectName;
    const projectId = run.projectId;
    const userId = (req as any).user?.id || null;

    const ignoredRows = new Map<string, Set<number>>();
    const overrideRows = new Map<string, Map<number, any>>();
    for (const issue of issues) {
      if (!issue.resolved) continue;
      const payload = issue.payloadJson as any;
      const row = payload?.row || payload?.sourceRow;
      if (row == null) continue;
      const section = issue.section;

      if (issue.resolution === "IGNORED") {
        if (!ignoredRows.has(section)) ignoredRows.set(section, new Set());
        ignoredRows.get(section)!.add(row);
      } else if (issue.resolution === "OVERRIDE" && issue.overrideData) {
        if (!overrideRows.has(section)) overrideRows.set(section, new Map());
        overrideRows.get(section)!.set(row, issue.overrideData as any);
      }
    }

    const counts = { planTasks: 0, revenueLines: 0, costLines: 0, executionPhases: 0, counterparties: 0 };

    await db.transaction(async (tx: any) => {
      if (projectId) {
        await tx.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.projectId, projectId));
        await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectId, projectId));
        await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId));
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectId, projectId));
      } else {
        await tx.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.projectName, projectName));
        await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectName, projectName));
        await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectName, projectName));
      }

      if (norm.planTasks && norm.planTasks.length > 0) {
        const planIgnored = ignoredRows.get("PLAN") || new Set();
        const planOverrides = overrideRows.get("PLAN") || new Map();
        const planValues = norm.planTasks
          .filter((t: any) => !planIgnored.has(t.sourceRow))
          .map((t: any) => {
            const ov = planOverrides.get(t.sourceRow);
            const merged = ov ? { ...t, ...ov } : t;
            return {
              projectId,
              projectName,
              taskName: merged.taskName,
              phase: merged.phase,
              startDate: merged.startDate,
              endDate: merged.endDate,
              durationDays: merged.durationDays,
              actualStartDate: merged.actualStartDate,
              actualEndDate: merged.actualEndDate,
              actualDurationDays: merged.actualDurationDays,
              owner: merged.owner,
              status: merged.status,
              pctComplete: merged.pctComplete,
              comment: merged.comment,
              sourceSheet: t.sourceSheet,
              sourceRow: t.sourceRow,
              importRunId: runId,
            };
          });
        if (planValues.length > 0) {
          await tx.insert(normalizedPlanTasks).values(planValues);
        }
        counts.planTasks = planValues.length;
      }

      if (norm.revenueLines && norm.revenueLines.length > 0) {
        const revIgnored = ignoredRows.get("REVENUE") || new Set();
        const revOverrides = overrideRows.get("REVENUE") || new Map();
        const revValues = norm.revenueLines
          .filter((r: any) => !revIgnored.has(r.sourceRow))
          .map((r: any) => {
            const ov = revOverrides.get(r.sourceRow);
            const merged = ov ? { ...r, ...ov } : r;
            return {
              projectId,
              projectName,
              description: merged.description,
              milestoneName: merged.milestoneName,
              amountExVat: merged.amountExVat,
              vat: merged.vat,
              invoiceNumber: merged.invoiceNumber,
              invoiceDate: merged.invoiceDate,
              expectedPaymentDate: merged.expectedPaymentDate,
              paidDate: merged.paidDate,
              inBankDate: merged.inBankDate,
              status: merged.status,
              sourceSheet: r.sourceSheet,
              sourceRow: r.sourceRow,
              importRunId: runId,
              turnaroundDays: merged.turnaroundDays,
            };
          });
        if (revValues.length > 0) {
          await tx.insert(normalizedRevenueLines).values(revValues);
        }
        counts.revenueLines = revValues.length;
      }

      const counterpartyMap = new Map<string, number>();
      if (norm.counterpartyNames && norm.counterpartyNames.length > 0) {
        for (const name of norm.counterpartyNames) {
          const normalized = name.trim().toLowerCase();
          const existing = await tx
            .select()
            .from(counterparties)
            .where(eq(counterparties.nameCanonical, name.trim()));

          if (existing.length > 0) {
            counterpartyMap.set(normalized, existing[0].id);
            await tx
              .update(counterparties)
              .set({ lastSeenAt: new Date() })
              .where(eq(counterparties.id, existing[0].id));
          } else {
            const allCps = await tx.select().from(counterparties);
            let aliasMatch: typeof allCps[0] | null = null;
            for (const cp of allCps) {
              const aliases = Array.isArray(cp.nameAliases) ? cp.nameAliases as string[] : [];
              if (aliases.some(a => a.toLowerCase() === normalized)) {
                aliasMatch = cp;
                break;
              }
            }

            if (aliasMatch) {
              counterpartyMap.set(normalized, aliasMatch.id);
              await tx
                .update(counterparties)
                .set({ lastSeenAt: new Date() })
                .where(eq(counterparties.id, aliasMatch.id));
            } else {
              const [created] = await tx
                .insert(counterparties)
                .values({
                  nameCanonical: name.trim(),
                  nameAliases: [],
                  typeDefault: "OTHER",
                  isCore: false,
                  createdBy: userId,
                  lastSeenAt: new Date(),
                })
                .returning();
              counterpartyMap.set(normalized, created.id);
              counts.counterparties++;
            }
          }
        }
      }

      if (norm.costLines && norm.costLines.length > 0) {
        const costIgnored = ignoredRows.get("EXPENDITURE") || new Set();
        const costOverrides = overrideRows.get("EXPENDITURE") || new Map();

        const classificationMap = new Map<number, any>();
        const classifications: any[] = summary.invoiceClassifications || [];
        for (const cl of classifications) {
          if (cl.outcome === "AUTO_APPLIED" || cl.outcome === "USER_CONFIRMED" || cl.outcome === "USER_OVERRIDDEN") {
            classificationMap.set(cl.sourceRow, cl);
          }
        }

        const costValues = norm.costLines
          .filter((c: any) => !costIgnored.has(c.sourceRow))
          .map((c: any) => {
            const ov = costOverrides.get(c.sourceRow);
            const merged = ov ? { ...c, ...ov } : c;
            const cpName = merged.counterpartyName?.trim();
            const cpId = cpName ? counterpartyMap.get(cpName.toLowerCase()) || null : null;

            const classification = classificationMap.get(c.sourceRow);
            const counterpartyType = classification?.inferredType || null;
            const classifiedCpId = classification?.inferredCounterpartyId || cpId;

            return {
              projectId,
              projectName,
              costCategory: merged.costCategory,
              counterpartyId: classifiedCpId,
              counterpartyName: merged.counterpartyName,
              counterpartyType,
              description: merged.description,
              amountExVat: merged.amountExVat,
              invoiceNumber: merged.invoiceNumber,
              invoiceDate: merged.invoiceDate,
              approvedDate: merged.approvedDate,
              paidDate: merged.paidDate,
              poNumber: merged.poNumber,
              status: merged.status,
              sourceSheet: c.sourceSheet,
              sourceRow: c.sourceRow,
              importRunId: runId,
              turnaroundDays: merged.turnaroundDays,
            };
          });
        if (costValues.length > 0) {
          await tx.insert(normalizedCostLines).values(costValues);
        }
        counts.costLines = costValues.length;

        if (classifications.length > 0) {
          const matchValues = classifications.map((cl: any) => ({
            importRunId: runId,
            projectId,
            invoiceNumberRaw: cl.invoiceNumberRaw,
            invoiceNumberNorm: cl.invoiceNumberNorm,
            matchedRuleId: cl.matchedRuleId || null,
            inferredType: cl.inferredType || "OTHER",
            inferredCounterpartyId: cl.inferredCounterpartyId || null,
            confidenceScore: cl.confidenceScore || 0,
            outcome: cl.outcome || "UNRESOLVED",
            sourceRow: cl.sourceRow,
            overrideReason: cl.overrideReason || null,
          }));
          for (const mv of matchValues) {
            await tx.insert(invoicePatternMatches).values(mv);
          }

          for (const cl of classifications) {
            if (cl.matchedRuleId && (cl.outcome === "AUTO_APPLIED" || cl.outcome === "USER_CONFIRMED")) {
              await tx
                .update(invoicePatternRules)
                .set({ timesMatched: sql`${invoicePatternRules.timesMatched} + 1` })
                .where(eq(invoicePatternRules.id, cl.matchedRuleId));
            }
          }
        }
      }

      if (norm.executionPhases && norm.executionPhases.length > 0) {
        const phaseValues = norm.executionPhases.map((p: any) => ({
          projectId,
          projectName,
          phaseName: p.phaseName,
          phaseDate: p.phaseDate,
          source: "EXCEL_IMPORT" as const,
          importRunId: runId,
        }));
        await tx.insert(normalizedExecutionPhases).values(phaseValues);
        counts.executionPhases = phaseValues.length;
      }

      const detectedInfo = summary.detection?.projectInfo;
      if (detectedInfo) {
        let resolvedProjectId = projectId;
        if (!resolvedProjectId && projectName) {
          const [existing] = await tx.select({ id: projectInfo.id }).from(projectInfo)
            .where(eq(projectInfo.projectName, projectName));
          if (existing) {
            resolvedProjectId = existing.id;
          } else {
            const underscoreName = projectName.replace(/\s+/g, "_");
            const trackerName = underscoreName + "_Tracker";
            const candidates = [
              underscoreName,
              trackerName,
              projectName + "_Tracker",
            ];
            for (const candidate of candidates) {
              const [match] = await tx.select({ id: projectInfo.id }).from(projectInfo)
                .where(eq(projectInfo.projectName, candidate));
              if (match) { resolvedProjectId = match.id; break; }
            }
            if (!resolvedProjectId) {
              const allProjects = await tx.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
              const normName = projectName.toLowerCase().replace(/[\s_]+/g, "").replace(/tracker$/i, "");
              for (const p of allProjects) {
                const normDB = p.projectName.toLowerCase().replace(/[\s_]+/g, "").replace(/tracker$/i, "");
                if (normDB === normName) { resolvedProjectId = p.id; break; }
              }
            }
          }
        }
        if (resolvedProjectId) {
          const VALID_PHASES = [
            "dlp", "financial close", "planning", "construction", "qa",
            "handover", "commercial close out",
            "compliance handover", "hold"
          ];
          const updates: Record<string, any> = {};
          if (detectedInfo.sizeKwp) updates.sizeKwp = String(detectedInfo.sizeKwp);
          if (detectedInfo.pd) updates.pd = String(detectedInfo.pd);
          if (detectedInfo.pm) updates.pm = String(detectedInfo.pm);
          if (detectedInfo.contractValue) updates.contractValue = String(detectedInfo.contractValue);
          const rawPhase = detectedInfo.phase ? String(detectedInfo.phase).trim() : null;
          if (rawPhase && VALID_PHASES.includes(rawPhase.toLowerCase())) {
            updates.phase = rawPhase;
            updates.executionPhase = rawPhase;
            updates.phaseUpdatedAt = new Date();
          }
          if (detectedInfo.pdHandoverDate) updates.pdHandoverDate = detectedInfo.pdHandoverDate;
          if (detectedInfo.constructionStartDate) updates.constructionStartDate = detectedInfo.constructionStartDate;
          if (detectedInfo.commissioningDate) updates.commissioningDate = detectedInfo.commissioningDate;
          if (detectedInfo.omHandoverDate) updates.omHandoverDate = detectedInfo.omHandoverDate;
          if (detectedInfo.clientHandoverDate) updates.clientHandoverDate = detectedInfo.clientHandoverDate;
          if (Object.keys(updates).length > 0) {
            updates.updatedAt = new Date();
            console.log(`[SmartImport] Updating projectInfo id=${resolvedProjectId} with:`, JSON.stringify(updates));
            await tx.update(projectInfo).set(updates).where(eq(projectInfo.id, resolvedProjectId));
          }
        } else {
          console.log(`[SmartImport] Could not resolve projectInfo for "${projectName}" — project metadata will not be updated`);
        }
      }

      await tx
        .update(smartImportRuns)
        .set({
          status: "COMMITTED",
          committedAt: new Date(),
          committedBy: userId,
        })
        .where(eq(smartImportRuns.id, runId));
    });

    // Record audit ChangeSet for the import commit
    try {
      const importFields: Array<{ fieldName: string; oldValue: string | null; newValue: string | null; dataType?: string }> = [];
      if (counts.planTasks > 0) importFields.push({ fieldName: "planTasks", oldValue: null, newValue: String(counts.planTasks), dataType: "number" });
      if (counts.revenueLines > 0) importFields.push({ fieldName: "revenueLines", oldValue: null, newValue: String(counts.revenueLines), dataType: "number" });
      if (counts.costLines > 0) importFields.push({ fieldName: "costLines", oldValue: null, newValue: String(counts.costLines), dataType: "number" });
      if (counts.executionPhases > 0) importFields.push({ fieldName: "executionPhases", oldValue: null, newValue: String(counts.executionPhases), dataType: "number" });
      if (counts.counterparties > 0) importFields.push({ fieldName: "counterparties", oldValue: null, newValue: String(counts.counterparties), dataType: "number" });

      await recordImportChange({
        actorUserId: userId,
        smartImportRunId: runId,
        entityType: "smart_import",
        entityId: String(runId),
        projectName: projectName || undefined,
        projectId: projectId || undefined,
        action: "IMPORT_COMMIT",
        summary: `Import committed: ${counts.planTasks} tasks, ${counts.revenueLines} revenue, ${counts.costLines} cost, ${counts.executionPhases} phases`,
        fileMetadata: { fileName: run.originalFileName, fileHash: run.fileHash },
        fields: importFields,
      });
    } catch (auditErr: any) {
      console.warn("[smart-import] Audit logging failed (non-blocking):", auditErr.message);
    }

    res.json({ success: true, runId, counts });
  } catch (err: any) {
    console.error("[smart-import] POST commit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/rollback
router.post("/api/smart-import/:runId/rollback", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status !== "COMMITTED") {
      return res.status(400).json({ error: "Only committed imports can be rolled back" });
    }

    await db.transaction(async (tx: any) => {
      await tx.delete(normalizedPlanTasks).where(eq(normalizedPlanTasks.importRunId, runId));
      await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.importRunId, runId));
      await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.importRunId, runId));
      await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.importRunId, runId));

      await tx
        .update(smartImportRuns)
        .set({ status: "ROLLED_BACK" })
        .where(eq(smartImportRuns.id, runId));
    });

    res.json({ success: true, runId, status: "ROLLED_BACK" });
  } catch (err: any) {
    console.error("[smart-import] POST rollback error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/counterparties
router.get("/api/counterparties", requireAuth, async (_req: Request, res: Response) => {
  try {
    const all = await db.select().from(counterparties).orderBy(counterparties.nameCanonical);
    res.json(all);
  } catch (err: any) {
    console.error("[counterparties] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/counterparties
router.post("/api/counterparties", requireAuth, async (req: Request, res: Response) => {
  try {
    const { nameCanonical, typeDefault, isCore, nameAliases } = req.body;
    if (!nameCanonical) return res.status(400).json({ error: "nameCanonical is required" });

    const userId = (req as any).user?.id || null;

    const [created] = await db
      .insert(counterparties)
      .values({
        nameCanonical: nameCanonical.trim(),
        nameAliases: nameAliases || [],
        typeDefault: typeDefault || "OTHER",
        isCore: isCore || false,
        createdBy: userId,
        lastSeenAt: new Date(),
      })
      .returning();

    res.status(201).json(created);
  } catch (err: any) {
    console.error("[counterparties] POST error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/counterparties/:id
router.patch("/api/counterparties/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid counterparty id" });

    const [existing] = await db.select().from(counterparties).where(eq(counterparties.id, id));
    if (!existing) return res.status(404).json({ error: "Counterparty not found" });

    const updates: Record<string, any> = {};
    if (req.body.nameCanonical !== undefined) updates.nameCanonical = req.body.nameCanonical.trim();
    if (req.body.nameAliases !== undefined) updates.nameAliases = req.body.nameAliases;
    if (req.body.typeDefault !== undefined) updates.typeDefault = req.body.typeDefault;
    if (req.body.isCore !== undefined) updates.isCore = req.body.isCore;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const [updated] = await db
      .update(counterparties)
      .set(updates)
      .where(eq(counterparties.id, id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    console.error("[counterparties] PATCH error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/counterparties/match
router.post("/api/counterparties/match", requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const normalizedName = name.trim().toLowerCase();

    const all = await db.select().from(counterparties);

    let bestMatch: any = null;
    let bestConfidence = 0;

    for (const cp of all) {
      const canonical = cp.nameCanonical.toLowerCase();
      if (canonical === normalizedName) {
        bestMatch = cp;
        bestConfidence = 1.0;
        break;
      }

      const aliases = (cp.nameAliases as string[]) || [];
      for (const alias of aliases) {
        if (alias.toLowerCase() === normalizedName) {
          bestMatch = cp;
          bestConfidence = 0.95;
          break;
        }
      }
      if (bestConfidence >= 0.95) break;

      if (canonical.includes(normalizedName) || normalizedName.includes(canonical)) {
        const similarity = Math.min(canonical.length, normalizedName.length) / Math.max(canonical.length, normalizedName.length);
        if (similarity > bestConfidence) {
          bestMatch = cp;
          bestConfidence = similarity * 0.8;
        }
      }
    }

    res.json({ match: bestMatch, confidence: Math.round(bestConfidence * 100) / 100 });
  } catch (err: any) {
    console.error("[counterparties] POST match error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/normalized/:projectName/plan
router.get("/api/smart-import/normalized/:projectName/plan", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "COMMITTED")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedPlanTasks)
      .where(eq(normalizedPlanTasks.importRunId, latestRun.id));

    res.json(records);
  } catch (err: any) {
    console.error("[smart-import] GET normalized plan error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/normalized/:projectName/revenue
router.get("/api/smart-import/normalized/:projectName/revenue", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "COMMITTED")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedRevenueLines)
      .where(eq(normalizedRevenueLines.importRunId, latestRun.id));

    res.json(records);
  } catch (err: any) {
    console.error("[smart-import] GET normalized revenue error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/smart-import/normalized/:projectName/expenditure
router.get("/api/smart-import/normalized/:projectName/expenditure", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "COMMITTED")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedCostLines)
      .where(eq(normalizedCostLines.importRunId, latestRun.id));

    res.json(records);
  } catch (err: any) {
    console.error("[smart-import] GET normalized expenditure error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/bulk-commit
router.post("/api/smart-import/bulk-commit", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || null;
    const { runIds, acknowledgeManualEdits, forceCommit } = req.body || {};

    let runs: any[];
    if (runIds && Array.isArray(runIds) && runIds.length > 0) {
      const validIds = runIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
      if (validIds.length === 0) {
        return res.json({ success: true, committed: 0, failed: 0, results: [] });
      }
      runs = await db.select().from(smartImportRuns)
        .where(and(
          inArray(smartImportRuns.id, validIds),
          eq(smartImportRuns.status, "PREVIEW")
        ));
    } else {
      runs = await db.select().from(smartImportRuns)
        .where(eq(smartImportRuns.status, "PREVIEW"));
    }

    if (runs.length === 0) {
      return res.json({ success: true, committed: 0, failed: 0, results: [] });
    }

    const results: Array<{
      runId: number;
      projectName: string;
      status: "committed" | "skipped" | "failed";
      counts?: any;
      error?: string;
    }> = [];

    for (const run of runs) {
      try {
        const summary = run.summaryJson as any;
        if (!summary || !summary.normalization) {
          results.push({ runId: run.id, projectName: run.projectName, status: "skipped", error: "No normalization data" });
          continue;
        }

        // Auto-resolve unresolved non-blocker issues by ignoring them
        const allIssues = await db.select().from(importIssues).where(eq(importIssues.importRunId, run.id));
        const unresolvedBlockers = allIssues.filter((i: any) => i.severity === "BLOCKER" && !i.resolved);

        // Auto-apply prior resolutions to unresolved issues
        const unresolvedIssues = allIssues.filter((i: any) => !i.resolved);
        if (unresolvedIssues.length > 0) {
          const activeRules = await db.select().from(issueResolutionRules)
            .where(and(
              eq(issueResolutionRules.active, true),
              eq(issueResolutionRules.projectName, run.projectName),
            ));
          const ruleMap = new Map<string, typeof activeRules[0]>();
          for (const rule of activeRules) {
            ruleMap.set(`${rule.issueType}::${rule.fingerprint}::${rule.section}`, rule);
          }

          for (const issue of unresolvedIssues) {
            if (!issue.issueType || !issue.issueFingerprint) continue;
            const lookupKey = `${issue.issueType}::${issue.issueFingerprint}::${issue.section}`;
            const rule = ruleMap.get(lookupKey);
            if (rule) {
              await db.update(importIssues)
                .set({
                  resolved: true,
                  resolution: rule.resolution,
                  resolutionNote: rule.resolutionNote,
                  resolvedBy: userId,
                  resolvedAt: new Date(),
                  autoResolved: true,
                  matchedRuleId: rule.id,
                })
                .where(eq(importIssues.id, issue.id));
            } else if (issue.severity !== "BLOCKER") {
              await db.update(importIssues)
                .set({
                  resolved: true,
                  resolution: "IGNORED",
                  resolutionNote: "Auto-ignored during bulk commit",
                  resolvedBy: userId,
                  resolvedAt: new Date(),
                  autoResolved: true,
                })
                .where(eq(importIssues.id, issue.id));
            }
          }
        }

        // Re-check for unresolved blockers after auto-resolution
        const remainingIssues = await db.select().from(importIssues)
          .where(and(eq(importIssues.importRunId, run.id), eq(importIssues.resolved, false)));
        const remainingBlockers = remainingIssues.filter((i: any) => i.severity === "BLOCKER");

        if (remainingBlockers.length > 0) {
          results.push({
            runId: run.id,
            projectName: run.projectName,
            status: "skipped",
            error: `${remainingBlockers.length} unresolved blocker issue(s)`,
          });
          continue;
        }

        const commitHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (req.headers.authorization) commitHeaders["Authorization"] = req.headers.authorization as string;
        if (req.headers.cookie) commitHeaders["Cookie"] = req.headers.cookie;

        const commitRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/smart-import/${run.id}/commit`, {
          method: "POST",
          headers: commitHeaders,
          body: JSON.stringify({ acknowledgeManualEdits: true, forceCommit: true, acknowledgeEqualDate: true }),
        });

        if (commitRes.ok) {
          const commitData = await commitRes.json();
          results.push({
            runId: run.id,
            projectName: run.projectName,
            status: "committed",
            counts: commitData.counts,
          });
        } else {
          const err = await commitRes.json().catch(() => ({ error: "Commit failed" }));
          results.push({
            runId: run.id,
            projectName: run.projectName,
            status: "failed",
            error: err.error || err.message || "Commit failed",
          });
        }
      } catch (runErr: any) {
        results.push({
          runId: run.id,
          projectName: run.projectName,
          status: "failed",
          error: runErr.message || "Unknown error",
        });
      }
    }

    const committed = results.filter(r => r.status === "committed").length;
    const failed = results.filter(r => r.status === "failed").length;
    const skipped = results.filter(r => r.status === "skipped").length;

    res.json({
      success: true,
      committed,
      failed,
      skipped,
      total: runs.length,
      results,
    });
  } catch (err: any) {
    console.error("[smart-import] POST bulk-commit error:", err);
    res.status(500).json({ error: err.message });
  }
});

export function registerSmartImportRoutes(app: Express) {
  app.use(router);
}
