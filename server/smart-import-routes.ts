// Smart Import API Routes
// Register in server/index.ts: import { registerSmartImportRoutes } from "./smart-import-routes"; registerSmartImportRoutes(app);

import { Express, Request, Response, NextFunction, Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logAuditFromReq } from "./audit-logger";
import { db } from "./db";
import { verifyToken } from "./jwt";
import { requirePermission } from "./permission-middleware";
import { runSmartImportPreview } from "./lib/import/index";
import {
  smartImportRuns,
  importIssues,
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
  workingPlanScenario,
  workingPlanTaskOverride,
  workingPlanDependencyOverride,
  auditEvents,
  workItems,
  workItemAssignments,
  workItemDependencies,
  projectPlanOverrides,
  planEditNotifications,
  users,
} from "@shared/schema";
import { recordImportChange, recordSystemEvent } from "./lib/audit/diff-engine";
import { eq, desc, and, or, sql, inArray, isNull } from "drizzle-orm";

function normalizeForComparison(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/\.(xlsx|xlsm|xls)$/i, "");
  n = n.replace(/[_\-]+/g, " ");
  n = n.replace(/\b(rev|revision|version|ver|v)\s*\d+\b/gi, "");
  n = n.replace(/\bv\d+(\.\d+)*\b/gi, "");
  n = n.replace(/\b(tracker|template|copy|final|draft|updated|new|old)\b/gi, "");
  n = n.replace(/\b(ph\d+|phase\s*\d+)\b/gi, "");
  n = n.replace(/\(\d+\)/g, "");
  n = n.replace(/\d{4}[-\/]\d{2}[-\/]\d{2}/g, "");
  n = n.replace(/\d{8,}/g, "");
  n = n.replace(/[^a-z0-9\s]/g, "");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0;

  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0;

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let matchCount = 0;
  for (const t of tokensA) {
    if (tokensB.includes(t)) matchCount++;
  }
  const tokenSimilarity = (2 * matchCount) / (tokensA.length + tokensB.length);

  const maxLen = Math.max(normA.length, normB.length);
  const minLen = Math.min(normA.length, normB.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (normA[i] === normB[i]) commonPrefix++;
    else break;
  }
  const prefixSimilarity = commonPrefix / maxLen;

  if (normA.includes(normB) || normB.includes(normA)) {
    return Math.max(0.85, tokenSimilarity, minLen / maxLen);
  }

  return Math.max(tokenSimilarity, prefixSimilarity);
}

async function findProjectMatches(projectName: string): Promise<Array<{ projectId: number; projectName: string; confidence: number; matchReason: string }>> {
  const allProjects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  const matches: Array<{ projectId: number; projectName: string; confidence: number; matchReason: string }> = [];

  const normInput = normalizeForComparison(projectName);

  for (const p of allProjects) {
    const normDB = normalizeForComparison(p.projectName);

    if (normInput === normDB) {
      matches.push({ projectId: p.id, projectName: p.projectName, confidence: 1.0, matchReason: "exact_normalized_match" });
      continue;
    }

    if (p.projectName.toLowerCase().trim() === projectName.toLowerCase().trim()) {
      matches.push({ projectId: p.id, projectName: p.projectName, confidence: 1.0, matchReason: "exact_case_insensitive_match" });
      continue;
    }

    const sim = computeSimilarity(projectName, p.projectName);
    if (sim >= 0.5) {
      let reason = "fuzzy_match";
      if (sim >= 0.85) reason = "high_confidence_match";
      else if (sim >= 0.7) reason = "medium_confidence_match";
      matches.push({ projectId: p.id, projectName: p.projectName, confidence: Math.round(sim * 100) / 100, matchReason: reason });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches.slice(0, 5);
}

async function checkRerunProtection(fileHash: string, fileName: string): Promise<{ isDuplicate: boolean; existingRun?: { id: number; projectName: string; status: string; uploadedAt: any } }> {
  const existing = await db.select({
    id: smartImportRuns.id,
    projectName: smartImportRuns.projectName,
    status: smartImportRuns.status,
    uploadedAt: smartImportRuns.uploadedAt,
  }).from(smartImportRuns)
    .where(eq(smartImportRuns.sourceFileHash, fileHash))
    .orderBy(desc(smartImportRuns.uploadedAt))
    .limit(1);

  if (existing.length > 0) {
    return { isDuplicate: true, existingRun: existing[0] };
  }
  return { isDuplicate: false };
}

function extractProjectNameFromFilename(fileName: string): string {
  let name = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  name = name.replace(/^\d+_/, "");
  const trackerIdx = name.toLowerCase().indexOf("tracker");
  if (trackerIdx > 0) {
    name = name.substring(0, trackerIdx);
  }
  name = name.replace(/\b(rev|revision|version|ver)\s*\d+\b/gi, "");
  name = name.replace(/\bv\d+(\.\d+)*\b/gi, "");
  name = name.replace(/[_\-]+/g, " ").replace(/[^a-zA-Z0-9\s]/g, "").trim();
  name = name.replace(/\s+/g, " ");
  return name || "Untitled Project";
}

function sanitizeUploadFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function extractStoredUploadTimestamp(fileName: string): number {
  const match = fileName.match(/^(\d+)_/);
  return match ? Number(match[1]) : 0;
}

async function pruneStoredUploadFiles(originalFileName: string, keepLatest = 2): Promise<void> {
  const sanitizedOriginal = sanitizeUploadFileName(originalFileName);
  const suffix = `_${sanitizedOriginal}`;
  const files = await fs.promises.readdir(uploadDir, { withFileTypes: true });
  const matchingFiles = files
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort((left, right) => extractStoredUploadTimestamp(right) - extractStoredUploadTimestamp(left));

  const filesToDelete = matchingFiles.slice(keepLatest);
  await Promise.all(
    filesToDelete.map(async (fileName) => {
      try {
        await fs.promises.unlink(path.join(uploadDir, fileName));
      } catch (error: any) {
        if (error?.code !== "ENOENT") {
          console.warn(`[SmartImport] Failed to prune stored upload ${fileName}:`, error?.message || error);
        }
      }
    }),
  );
}

function formatImportIssueForCommit(issue: any) {
  const payload = issue?.payloadJson && typeof issue.payloadJson === "object" ? issue.payloadJson as Record<string, any> : {};
  return {
    id: issue.id,
    section: issue.section,
    message: issue.message,
    issueType: issue.issueType || null,
    rowReference: payload.rowNumber ?? payload.row ?? payload.sourceRow ?? payload.lineNumber ?? null,
    field: payload.field ?? payload.column ?? payload.canonicalField ?? payload.header ?? null,
    reason: payload.reason ?? payload.errorReason ?? issue.suggestedAction ?? null,
    expected: payload.expected ?? payload.expectedType ?? payload.expectedValue ?? null,
  };
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
      const sanitized = sanitizeUploadFileName(file.originalname);
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

router.get("/api/smart-import/runs", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, project_name, status, source_file_name as file_name,
             uploaded_at, committed_at, uploaded_by, committed_by
      FROM smart_import_runs
      ORDER BY uploaded_at DESC
      LIMIT 100
    `);
    const results = Array.isArray(rows) ? rows : (rows.rows || []);
    res.json(results);
  } catch (err: any) {
    console.error("[SmartImport] List runs error:", err);
    res.status(500).json({ error: "Failed to list import runs" });
  }
});

// POST /api/smart-import/upload
router.post("/api/smart-import/upload", requireAuth, requirePermission("smart_import", "edit"), (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      const message = err.message || "File upload failed";
      return res.status(400).json({ error: message });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (readErr: any) {
      return res.status(400).json({ error: "Failed to read uploaded file" });
    }

    console.log(`[SmartImport] Processing file: ${fileName} (${buffer.length} bytes)`);

    const preview = await runSmartImportPreview(buffer, fileName);
    
    console.log(`[SmartImport] Detection: ${preview.detection.sections.length} sections, ${preview.detection.unmatched.length} unmatched`);

    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const rerunCheck = await checkRerunProtection(fileHash, fileName);
    let rerunWarning: { isDuplicate: boolean; existingRunId?: number; existingProjectName?: string; existingStatus?: string; existingUploadedAt?: any } | undefined;
    if (rerunCheck.isDuplicate && rerunCheck.existingRun) {
      rerunWarning = {
        isDuplicate: true,
        existingRunId: rerunCheck.existingRun.id,
        existingProjectName: rerunCheck.existingRun.projectName,
        existingStatus: rerunCheck.existingRun.status,
        existingUploadedAt: rerunCheck.existingRun.uploadedAt,
      };
      console.log(`[SmartImport] Rerun detected: file hash matches run #${rerunCheck.existingRun.id} (${rerunCheck.existingRun.projectName}, status=${rerunCheck.existingRun.status})`);
    }

    const projectName = extractProjectNameFromFilename(fileName);

    const projectMatches = await findProjectMatches(projectName);
    const bestMatch = projectMatches.length > 0 ? projectMatches[0] : null;
    const autoMappedProjectId = bestMatch && bestMatch.confidence >= 0.85 ? bestMatch.projectId : null;
    const matchDiagnostics = {
      extractedName: projectName,
      normalizedName: normalizeForComparison(projectName),
      matchCandidates: projectMatches,
      autoMappedProjectId,
      autoMappedProjectName: bestMatch && bestMatch.confidence >= 0.85 ? bestMatch.projectName : null,
      requiresUserConfirmation: projectMatches.length > 0 && !autoMappedProjectId && projectMatches.some(m => m.confidence >= 0.5),
    };

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

    const resolvedProjectId = projectId || autoMappedProjectId || null;

    const [run] = await db
      .insert(smartImportRuns)
      .values({
        projectId: resolvedProjectId,
        projectName: autoMappedProjectId && bestMatch ? bestMatch.projectName : projectName,
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

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(run.id),
      action: "upload",
      projectName: run.projectName,
      source: "IMPORT",
      changesJson: { fileName, fileHash, sections: preview.detection.sections.length, issues: preview.normalization.issues.length, autoMappedProjectId, rerunDetected: !!rerunWarning },
    });

    await pruneStoredUploadFiles(fileName, 2);

    res.json({
      runId: run.id,
      preview,
      matchDiagnostics,
      rerunWarning: rerunWarning || null,
    });
  } catch (err: any) {
    console.error("[smart-import] POST upload error:", err.message);
    let userMessage = err.message || "Unknown error";
    let statusCode = 500;
    if (userMessage.startsWith("PARSE_ERROR:")) {
      userMessage = userMessage.replace("PARSE_ERROR: ", "");
      statusCode = 400;
    } else if (userMessage.includes("End of data reached") || userMessage.includes("Unexpected EOF") || userMessage.includes("Invalid signature")) {
      userMessage = "The file appears to be corrupted or is not a valid Excel file. Please open it in Excel, save as a new .xlsx file, and try again.";
      statusCode = 400;
    } else if (userMessage.includes("encrypted") || userMessage.includes("password")) {
      userMessage = "The file is password-protected. Please remove the password in Excel and re-upload.";
      statusCode = 400;
    } else if (userMessage.includes("ENOMEM") || userMessage.includes("heap")) {
      userMessage = "The file is too large to process. Try splitting it into smaller files or removing unused sheets.";
      statusCode = 400;
    } else if (userMessage.includes("ENOENT")) {
      userMessage = "The uploaded file could not be found on the server. Please try uploading again.";
      statusCode = 400;
    }
    res.status(statusCode).json({ error: userMessage });
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
router.get("/api/smart-import/pending-runs", requireAuth, requirePermission("smart_import", "view"), async (_req: Request, res: Response) => {
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

router.get("/api/smart-import/project-matches/:name", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name as string);
    const matches = await findProjectMatches(name);
    res.json({
      inputName: name,
      normalizedName: normalizeForComparison(name),
      matches,
    });
  } catch (err: any) {
    console.error("[smart-import] GET project-matches error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/smart-import/:runId/assign-project", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const { projectId: targetProjectId } = req.body;
    if (!targetProjectId) return res.status(400).json({ error: "projectId is required" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const [targetProject] = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo).where(eq(projectInfo.id, parseInt(targetProjectId)));
    if (!targetProject) return res.status(404).json({ error: "Target project not found" });

    await db.update(smartImportRuns)
      .set({ projectId: targetProject.id, projectName: targetProject.projectName })
      .where(eq(smartImportRuns.id, runId));

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "assign_project",
      source: "IMPORT",
      changesJson: { previousProjectName: run.projectName, newProjectId: targetProject.id, newProjectName: targetProject.projectName },
    });

    res.json({ success: true, projectId: targetProject.id, projectName: targetProject.projectName });
  } catch (err: any) {
    console.error("[smart-import] PATCH assign-project error:", err);
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
router.patch("/api/smart-import/:runId/project-info", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "update_project_info",
      source: "IMPORT",
      changesJson: { updates },
    });

    res.json({ success: true, projectInfo: summary.detection.projectInfo });
  } catch (err: any) {
    console.error("[smart-import] PATCH project-info error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/mapping
router.patch("/api/smart-import/:runId/mapping", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "update_mapping",
      source: "IMPORT",
      changesJson: { section, colIndex, canonicalField },
    });

    res.json({ success: true, updatedMapping: { section, colIndex, canonicalField } });
  } catch (err: any) {
    console.error("[smart-import] PATCH mapping error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/smart-import/:runId/issue/:issueId/resolve
router.patch("/api/smart-import/:runId/issue/:issueId/resolve", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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

    logAuditFromReq(req, {
      entityType: "smart_import_issue",
      entityId: String(issueId),
      action: resolved ? "resolve_issue" : "unresolve_issue",
      source: "IMPORT",
      changesJson: { runId, resolution: resType, rememberDecision: !!rememberDecision },
    });

    res.json(updated);
  } catch (err: any) {
    console.error("[smart-import] PATCH resolve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/ignore-all-blockers
router.post("/api/smart-import/:runId/ignore-all-blockers", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "ignore_all_blockers",
      source: "IMPORT",
      changesJson: { ignored },
    });

    res.json({ ignored, issues: updatedIssues });
  } catch (err: any) {
    console.error("[smart-import] POST ignore-all-blockers error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/allow-all
router.post("/api/smart-import/:runId/allow-all", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const userId = (req as any).user?.id || null;
    const allIssues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    const unresolved = allIssues.filter((i: any) => !i.resolved);

    let allowed = 0;
    for (const issue of unresolved) {
      await db.update(importIssues)
        .set({
          resolved: true,
          resolution: "ALLOW_ALL",
          resolutionNote: "Allowed as-is — import all data without filtering",
          resolvedBy: userId,
          resolvedAt: new Date(),
        })
        .where(eq(importIssues.id, issue.id));
      allowed++;
    }

    const updatedIssues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "allow_all",
      source: "IMPORT",
      changesJson: { allowed },
    });

    res.json({ allowed, issues: updatedIssues });
  } catch (err: any) {
    console.error("[smart-import] POST allow-all error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/apply-prior-resolutions
router.post("/api/smart-import/:runId/apply-prior-resolutions", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "apply_prior_resolutions",
      source: "IMPORT",
      changesJson: { applied },
    });

    res.json({ applied, issues: updatedIssues });
  } catch (err: any) {
    console.error("[smart-import] POST apply-prior-resolutions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/commit
router.post("/api/smart-import/:runId/commit", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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
    const preserveManualEdits = req.body?.preserveManualEdits === true;
    const conflictResolutions = req.body?.conflictResolutions as Record<string, "keep" | "import"> | undefined;

    const hasConflictResolutions = conflictResolutions && Object.keys(conflictResolutions).length > 0;

    if (!acknowledgeManualEdits && !preserveManualEdits && !hasConflictResolutions && run.projectId) {
      const existingCostLines = await db.select().from(normalizedCostLines)
        .where(eq(normalizedCostLines.projectId, run.projectId));

      const manuallyModifiedRows = existingCostLines.filter(row =>
        row.cosRealised === true ||
        row.invoiceDateConfirmed === true ||
        row.paidDateConfirmed === true ||
        row.noRevenueLinked === true ||
        row.cashflowConfirmed === true
      );

      const manualEditChangeSets = await db
        .select({ count: sql<number>`count(*)` })
        .from(changeSets)
        .where(and(
          eq(changeSets.projectId, run.projectId),
          eq(changeSets.entityType, "expense_line"),
          eq(changeSets.source, "MANUAL_EDIT")
        ));
      const changeSetCount = Number(manualEditChangeSets[0]?.count || 0);

      if (manuallyModifiedRows.length > 0) {
        const norm = (run.summaryJson as any)?.normalization;
        const importCostLines = norm?.costLines || [];

        const conflicts: Array<{
          sourceRow: number;
          description: string;
          costCategory: string;
          field: string;
          currentValue: string;
          importValue: string;
        }> = [];

        for (const existing of manuallyModifiedRows) {
          const matchingImport = importCostLines.find((imp: any) => imp.sourceRow === existing.sourceRow);
          if (existing.cosRealised) {
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "COS Realised",
              currentValue: "Yes (manually confirmed)",
              importValue: matchingImport?.cosRealised ? "Yes" : "No",
            });
          }
          if (existing.invoiceDateConfirmed) {
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Invoice Date Confirmed",
              currentValue: "Yes (manually confirmed)",
              importValue: matchingImport?.invoiceDateConfirmed ? "Yes" : "No",
            });
          }
          if (existing.paidDateConfirmed) {
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Paid Date Confirmed",
              currentValue: "Yes (manually confirmed)",
              importValue: matchingImport?.paidDateConfirmed ? "Yes" : "No",
            });
          }
          if (existing.noRevenueLinked) {
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "No Revenue Linked",
              currentValue: "Yes (manually set)",
              importValue: "No",
            });
          }
          if (existing.cashflowConfirmed) {
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Cashflow Confirmed",
              currentValue: "Yes (manually confirmed)",
              importValue: matchingImport?.cashflowConfirmed ? "Yes" : "No",
            });
          }
        }

        return res.status(409).json({
          error: "manual_edits_warning",
          message: `This project has ${manuallyModifiedRows.length} cost line(s) with manual edits that will be affected by this import.`,
          manualEditCount: manuallyModifiedRows.length,
          changeSetCount,
          conflicts,
          hint: "Choose 'preserveManualEdits' to keep your manual changes, or 'acknowledgeManualEdits' to overwrite them with the imported data.",
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
        error: "unresolved_blockers",
        message: "Unresolved blocker issues must be resolved before committing.",
        unresolvedBlockers: unresolvedBlockers.map((issue: any) => formatImportIssueForCommit(issue)),
      });
    }

    const summary = run.summaryJson as any;
    if (!summary || !summary.normalization) {
      return res.status(400).json({ error: "No normalization data found in this import run" });
    }

    const norm = summary.normalization;
    const projectName = run.projectName;
    let projectId = run.projectId;
    const userId = (req as any).user?.id || null;

    // Canonical governance: imported plan promotion is blocked while unresolved
    // front-end plan edits exist. plan_edit_notifications is the single source
    // of truth for unresolved plan edit conflicts.
    if (Array.isArray(norm.planTasks) && norm.planTasks.length > 0) {
      const unresolvedPlanEdits = await db
        .select({
          id: planEditNotifications.id,
          taskId: planEditNotifications.taskId,
          taskName: planEditNotifications.taskName,
          editType: planEditNotifications.editType,
          fieldName: planEditNotifications.fieldName,
          oldValue: planEditNotifications.oldValue,
          newValue: planEditNotifications.newValue,
          createdAt: planEditNotifications.createdAt,
        })
        .from(planEditNotifications)
        .where(and(
          eq(planEditNotifications.status, "pending"),
          projectId
            ? or(
                eq(planEditNotifications.projectId, projectId),
                eq(planEditNotifications.projectName, projectName),
              )
            : eq(planEditNotifications.projectName, projectName),
        ))
        .orderBy(desc(planEditNotifications.createdAt));

      if (unresolvedPlanEdits.length > 0) {
        return res.status(409).json({
          error: "plan_edit_conflict_block",
          message: "Unresolved front-end project plan edits were found. Resolve plan_edit_notifications before promoting this import.",
          unresolvedCount: unresolvedPlanEdits.length,
          conflicts: unresolvedPlanEdits,
          hint: "Resolve each notification by choosing keep_frontend_update, use_import_value, or merge_manual before re-running commit.",
        });
      }
    }

    if (req.body?.projectId && !projectId) {
      const overrideProjectId = parseInt(req.body.projectId);
      if (!isNaN(overrideProjectId)) {
        const [existsCheck] = await db.select({ id: projectInfo.id }).from(projectInfo)
          .where(eq(projectInfo.id, overrideProjectId));
        if (existsCheck) {
          projectId = overrideProjectId;
          await db.update(smartImportRuns).set({ projectId }).where(eq(smartImportRuns.id, runId));
        }
      }
    }

    if (!projectId && projectName) {
      const existingProj = await db.select({ id: projectInfo.id }).from(projectInfo)
        .where(eq(projectInfo.projectName, projectName)).limit(1);
      if (existingProj.length > 0) {
        projectId = existingProj[0].id;
        await db.update(smartImportRuns).set({ projectId }).where(eq(smartImportRuns.id, runId));
      } else {
        const forceRecreate = req.body?.forceRecreate === true;
        const confirmNewProject = req.body?.confirmNewProject === true;
        if (!forceRecreate) {
          const deletedAudit = await db.select({ id: auditEvents.id, createdAt: auditEvents.createdAt, userName: auditEvents.userName })
            .from(auditEvents)
            .where(and(
              eq(auditEvents.action, "hard_delete"),
              eq(auditEvents.projectName, projectName + " [DELETED]"),
            ))
            .orderBy(desc(auditEvents.createdAt))
            .limit(1);
          if (deletedAudit.length > 0) {
            const deletedAt = deletedAudit[0].createdAt;
            const deletedBy = deletedAudit[0].userName || "unknown";
            return res.status(409).json({
              error: "previously_deleted",
              message: `"${projectName}" was previously deleted by ${deletedBy} on ${new Date(deletedAt).toLocaleDateString()}. Importing will re-create this project from scratch.`,
              deletedAt,
              deletedBy,
              hint: "Set forceRecreate=true to confirm re-creation.",
            });
          }
        }

        if (!confirmNewProject) {
          const closeMatches = await findProjectMatches(projectName);
          const significantMatches = closeMatches.filter(m => m.confidence >= 0.5);
          if (significantMatches.length > 0) {
            return res.status(409).json({
              error: "duplicate_project_candidate",
              message: `A similar project already exists. "${projectName}" closely matches existing project(s). Please select the correct project or confirm creating a new one.`,
              matchCandidates: significantMatches,
              hint: "Set confirmNewProject=true to create a new project, or set projectId in the request body to map to an existing project.",
            });
          }
        }

        const detectedInfo = summary.detection?.projectInfo;
        const [newProject] = await db.insert(projectInfo).values({
          projectName,
          phase: detectedInfo?.phase || "PLANNING",
          sizeKwp: detectedInfo?.sizeKwp || null,
          pd: detectedInfo?.pd || null,
          contractValue: detectedInfo?.contractValue || null,
        } as any).returning();
        projectId = newProject.id;
        await db.update(smartImportRuns).set({ projectId }).where(eq(smartImportRuns.id, runId));
      }
    }

    const ignoredRows = new Map<string, Set<number>>();
    const overrideRows = new Map<string, Map<number, any>>();
    for (const issue of issues) {
      if (!issue.resolved) continue;
      const payload = issue.payloadJson as any;
      const row = payload?.row || payload?.sourceRow;
      if (row == null) continue;
      const section = issue.section;

      if (issue.resolution === "IGNORED" || issue.resolution === "SKIP_ROW" || issue.resolution === "EXCLUDE") {
        if (!ignoredRows.has(section)) ignoredRows.set(section, new Set());
        ignoredRows.get(section)!.add(row);
      } else if (issue.resolution === "OVERRIDE" && issue.overrideData) {
        if (!overrideRows.has(section)) overrideRows.set(section, new Map());
        overrideRows.get(section)!.set(row, issue.overrideData as any);
      }
    }

    const counts = { planTasks: 0, revenueLines: 0, costLines: 0, executionPhases: 0, counterparties: 0 };
    const skippedOverrideFields: Array<{ row: number; field: string; importValue: string; manualValue: string }> = [];

    let preservedManualEditsCount = 0;

    await db.transaction(async (tx: any) => {
      const existingTaskOwners = new Map<string, string>();
      {
        const existingWiTasks = projectId
          ? await tx.select({ title: workItems.title, ownerName: workItems.ownerName }).from(workItems)
              .where(and(eq(workItems.projectId, projectId), eq(workItems.workstream, "PM"), eq(workItems.source, "SMART_IMPORT")))
          : await tx.select({ title: workItems.title, ownerName: workItems.ownerName }).from(workItems)
              .where(and(sql`${workItems.externalRef} LIKE ${projectName + '::PLAN::%'}`, eq(workItems.workstream, "PM")));
        for (const t of existingWiTasks) {
          if (t.ownerName && t.ownerName.trim()) {
            existingTaskOwners.set(t.title, t.ownerName);
          }
        }
      }

      const manualEditsToPreserve = new Map<number, {
        cosRealised?: boolean;
        invoiceDateConfirmed?: boolean;
        paidDateConfirmed?: boolean;
        noRevenueLinked?: boolean;
        cashflowConfirmed?: boolean;
      }>();

      if (preserveManualEdits || conflictResolutions) {
        const existingCostRows = projectId
          ? await tx.select().from(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId))
          : await tx.select().from(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));

        for (const row of existingCostRows) {
          const hasManualEdits = row.cosRealised || row.invoiceDateConfirmed || row.paidDateConfirmed || row.noRevenueLinked || row.cashflowConfirmed;
          if (!hasManualEdits || row.sourceRow == null) continue;

          if (conflictResolutions) {
            const edits: Record<string, boolean> = {};
            const fields: Record<string, string> = {
              cosRealised: "COS Realised",
              invoiceDateConfirmed: "Invoice Date Confirmed",
              paidDateConfirmed: "Paid Date Confirmed",
              noRevenueLinked: "No Revenue Linked",
              cashflowConfirmed: "Cashflow Confirmed",
            };
            for (const [dbField, label] of Object.entries(fields)) {
              if ((row as any)[dbField]) {
                const key = `${row.sourceRow}::${label}`;
                if (conflictResolutions[key] === "keep") {
                  (edits as any)[dbField] = true;
                }
              }
            }
            if (Object.keys(edits).length > 0) {
              manualEditsToPreserve.set(row.sourceRow, edits as any);
            }
          } else {
            manualEditsToPreserve.set(row.sourceRow, {
              cosRealised: row.cosRealised || undefined,
              invoiceDateConfirmed: row.invoiceDateConfirmed || undefined,
              paidDateConfirmed: row.paidDateConfirmed || undefined,
              noRevenueLinked: row.noRevenueLinked || undefined,
              cashflowConfirmed: row.cashflowConfirmed || undefined,
            });
          }
        }
      }

      if (projectId) {
        await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectId, projectId));
        await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId));
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectId, projectId));
      } else {
        await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectName, projectName));
        await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectName, projectName));
      }
      const scenarioIds = await tx
        .select({ id: workingPlanScenario.id })
        .from(workingPlanScenario)
        .where(eq(workingPlanScenario.projectName, projectName));
      if (scenarioIds.length > 0) {
        const sIds = scenarioIds.map((s: any) => s.id);
        await tx.update(workingPlanTaskOverride)
          .set({ importedTaskId: null })
          .where(inArray(workingPlanTaskOverride.scenarioId, sIds));
        await tx.update(workingPlanDependencyOverride)
          .set({ importedDependencyId: null })
          .where(inArray(workingPlanDependencyOverride.scenarioId, sIds));
      }

      const manualOverridesForProject = await tx.select().from(projectPlanOverrides)
        .where(eq(projectPlanOverrides.projectName, projectName));
      const manualOverrideMap = new Map<number, Map<string, string>>();
      for (const ov of manualOverridesForProject) {
        if (!manualOverrideMap.has(ov.rowNumber)) manualOverrideMap.set(ov.rowNumber, new Map());
        manualOverrideMap.get(ov.rowNumber)!.set(ov.fieldName, ov.overrideValue || '');
      }

      const existingWorkItemsForImport = await tx
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(
          eq(workItems.source, "SMART_IMPORT"),
          eq(workItems.workstream, "PM"),
          projectId
            ? eq(workItems.projectId, projectId)
            : sql`${workItems.externalRef} LIKE ${projectName + '::PLAN::%'}`,
        ));
      if (existingWorkItemsForImport.length > 0) {
        const wiIds = existingWorkItemsForImport.map((w: { id: number }) => w.id);
        await tx.delete(workItemDependencies).where(
          or(
            inArray(workItemDependencies.predecessorId, wiIds),
            inArray(workItemDependencies.successorId, wiIds),
          )
        );
        await tx.delete(workItemAssignments).where(inArray(workItemAssignments.workItemId, wiIds));
        await tx.delete(workItems).where(inArray(workItems.id, wiIds));
      }

      const OVERRIDE_FIELD_MAP: Record<string, string> = {
        actualStart: 'startDate', actualEnd: 'endDate', actualPctComplete: 'pctComplete',
        startDate: 'startDate', endDate: 'endDate', percentComplete: 'pctComplete',
        status: 'status', owner: 'owner', comment: 'comment',
      };

      if (norm.planTasks && norm.planTasks.length > 0) {
        const planIgnored = ignoredRows.get("PLAN") || new Set();
        const planOverrides = overrideRows.get("PLAN") || new Map();
        const planValues = norm.planTasks
          .filter((t: any) => !planIgnored.has(t.sourceRow))
          .map((t: any) => {
            const ov = planOverrides.get(t.sourceRow);
            const merged = ov ? { ...t, ...ov } : t;
            const result: any = {
              projectId,
              projectName,
              taskName: merged.taskName,
              taskNo: merged.taskNo || null,
              phase: merged.phase,
              startDate: merged.startDate,
              endDate: merged.endDate,
              durationDays: merged.durationDays,
              actualStartDate: merged.actualStartDate,
              actualEndDate: merged.actualEndDate,
              actualDurationDays: merged.actualDurationDays,
              owner: existingTaskOwners.get(merged.taskName) || merged.owner,
              status: merged.status,
              pctComplete: merged.pctComplete,
              expectedPctComplete: merged.expectedPctComplete ?? null,
              comment: merged.comment,
              isMilestone: merged.isMilestone ?? false,
              parentTaskNo: merged.parentTaskNo ?? null,
              indentLevel: merged.indentLevel ?? 0,
              sourceSheet: t.sourceSheet,
              sourceRow: t.sourceRow,
              importRunId: runId,
            };
            const rowOverrides = manualOverrideMap.get(t.sourceRow);
            if (rowOverrides) {
              for (const [overrideField, manualValue] of Array.from(rowOverrides.entries())) {
                const mappedField = OVERRIDE_FIELD_MAP[overrideField] || overrideField;
                if (mappedField in result) {
                  const importValue = String(result[mappedField] ?? '');
                  skippedOverrideFields.push({ row: t.sourceRow, field: overrideField, importValue, manualValue });
                  result[mappedField] = manualValue;
                }
              }
            }
            return result;
          });
        if (planValues.length > 0) {
          const workItemByTaskNo = new Map<string, number>();
          const workItemByIdx = new Map<number, number>();

          for (let idx = 0; idx < planValues.length; idx++) {
            const pv = planValues[idx] as any;
            const wbsCode = pv.taskNo || null;
            const rowRef = pv.sourceRow != null ? `ROW-${pv.sourceRow}` : `IDX-${idx}`;
            const projectRef = projectId ? `PID-${projectId}` : projectName;
            const externalRef = `${projectRef}::PLAN::${rowRef}::${wbsCode || ''}`;

            const [insertedWi] = await tx.insert(workItems).values({
              clientId: null,
              projectId: projectId || null,
              workstream: "PM" as any,
              type: pv.isMilestone ? "milestone" : "task",
              source: "SMART_IMPORT" as any,
              title: pv.taskName,
              description: pv.comment || null,
              status: pv.status || "Not Started",
              priority: null,
              startDate: pv.startDate || pv.actualStartDate || null,
              endDate: pv.endDate || pv.actualEndDate || null,
              duration: pv.durationDays || pv.actualDurationDays || null,
              actualStart: pv.actualStartDate || null,
              actualEnd: pv.actualEndDate || null,
              actualDuration: pv.actualDurationDays || null,
              percentComplete: pv.pctComplete != null ? Number(pv.pctComplete) : 0,
              expectedPctComplete: pv.expectedPctComplete != null ? Number(pv.expectedPctComplete) : null,
              wbsCode: wbsCode,
              outlineNumber: wbsCode,
              indentLevel: pv.indentLevel ?? 0,
              isMilestone: pv.isMilestone ?? false,
              phase: pv.phase || null,
              parentId: null,
              ownerUserId: null,
              ownerName: pv.owner || null,
              isShared: false,
              externalRef,
              legacyTable: null,
              legacyId: null,
              sourceRow: pv.sourceRow || null,
              sourceSheet: pv.sourceSheet || null,
              importRunId: runId,
              createdBy: userId,
            }).returning();

            if (wbsCode) {
              workItemByTaskNo.set(wbsCode, insertedWi.id);
            }
            workItemByIdx.set(idx, insertedWi.id);
          }

          for (let idx = 0; idx < planValues.length; idx++) {
            const pv = planValues[idx] as any;
            if (pv.parentTaskNo && workItemByTaskNo.has(pv.parentTaskNo)) {
              const parentWorkItemId = workItemByTaskNo.get(pv.parentTaskNo)!;
              const childWorkItemId = workItemByIdx.get(idx);
              if (childWorkItemId) {
                await tx.update(workItems)
                  .set({ parentId: parentWorkItemId })
                  .where(eq(workItems.id, childWorkItemId));
              }
            }
          }

          if (userId) {
            for (let idx = 0; idx < planValues.length; idx++) {
              const pv = planValues[idx] as any;
              if (pv.owner && pv.owner.trim()) {
                const wiId = workItemByIdx.get(idx);
                if (wiId && pv.assigneeUserId) {
                  await tx.insert(workItemAssignments).values({
                    workItemId: wiId,
                    userId: pv.assigneeUserId,
                    role: "OWNER" as any,
                    allocationPct: null,
                  });
                }
              }
            }
          }
        }
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
              invoiceDateFontColor: merged.invoiceDateFontColor || null,
              invoiceDateConfirmed: merged.invoiceDateConfirmed || false,
              expectedPaymentDate: merged.expectedPaymentDate,
              paidDate: merged.paidDate,
              paidDateFontColor: merged.paidDateFontColor || null,
              paidDateConfirmed: merged.paidDateConfirmed || false,
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
              invoiceDateFontColor: merged.invoiceDateFontColor || null,
              invoiceDateConfirmed: merged.invoiceDateConfirmed || false,
              approvedDate: merged.approvedDate,
              paidDate: merged.paidDate,
              paidDateFontColor: merged.paidDateFontColor || null,
              paidDateConfirmed: merged.paidDateConfirmed || false,
              poNumber: merged.poNumber,
              cosRealised: merged.cosRealised || false,
              cashflowConfirmed: merged.cashflowConfirmed || false,
              status: merged.status,
              sourceSheet: c.sourceSheet,
              sourceRow: c.sourceRow,
              importRunId: runId,
              turnaroundDays: merged.turnaroundDays,
              _budgetQty: merged.budgetQty || null,
              _budgetRate: merged.budgetRate || null,
              _budgetTotal: merged.budgetTotal || null,
              _budgetCos: merged.budgetCos || null,
              _actualCos: merged.actualCos || null,
              _revenueRecognitionAmount: merged.revenueRecognitionAmount || null,
              _forecastPaymentDate: merged.forecastPaymentDate || null,
            };
          });
        if (costValues.length > 0) {
          const normalizedInserts = costValues.map((c: any) => {
            const { _budgetQty, _budgetRate, _budgetTotal, _budgetCos, _actualCos, _revenueRecognitionAmount, _forecastPaymentDate, ...normalized } = c;
            return normalized;
          });
          await tx.insert(normalizedCostLines).values(normalizedInserts);

          if (manualEditsToPreserve.size > 0) {
            const insertedRows = projectId
              ? await tx.select({ id: normalizedCostLines.id, sourceRow: normalizedCostLines.sourceRow }).from(normalizedCostLines).where(eq(normalizedCostLines.projectId, projectId))
              : await tx.select({ id: normalizedCostLines.id, sourceRow: normalizedCostLines.sourceRow }).from(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));

            for (const inserted of insertedRows) {
              if (inserted.sourceRow == null) continue;
              const preserved = manualEditsToPreserve.get(inserted.sourceRow);
              if (!preserved) continue;

              const updates: Record<string, boolean> = {};
              if (preserved.cosRealised) updates.cosRealised = true;
              if (preserved.invoiceDateConfirmed) updates.invoiceDateConfirmed = true;
              if (preserved.paidDateConfirmed) updates.paidDateConfirmed = true;
              if (preserved.noRevenueLinked) updates.noRevenueLinked = true;
              if (preserved.cashflowConfirmed) updates.cashflowConfirmed = true;

              if (Object.keys(updates).length > 0) {
                await tx.update(normalizedCostLines).set(updates).where(eq(normalizedCostLines.id, inserted.id));
                preservedManualEditsCount++;
              }
            }
          }
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
          const [existingProject] = await tx.select({ pm: projectInfo.pm, pd: projectInfo.pd }).from(projectInfo)
            .where(eq(projectInfo.id, resolvedProjectId));
          const updates: Record<string, any> = {};
          if (detectedInfo.sizeKwp) updates.sizeKwp = String(detectedInfo.sizeKwp);
          if (detectedInfo.pd && (!existingProject?.pd || !existingProject.pd.trim())) updates.pd = String(detectedInfo.pd);
          if (detectedInfo.pm && (!existingProject?.pm || !existingProject.pm.trim())) updates.pm = String(detectedInfo.pm);
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

      const totalAttempted = (norm.planTasks?.length || 0) + (norm.revenueLines?.length || 0) + (norm.costLines?.length || 0) + (norm.executionPhases?.length || 0);
      const totalSucceeded = (counts.planTasks || 0) + (counts.revenueLines || 0) + (counts.costLines || 0) + (counts.executionPhases || 0);
      const totalFailed = totalAttempted - totalSucceeded;
      const detectedSections: string[] = [];
      if (norm.planTasks?.length > 0) detectedSections.push("PLAN");
      if (norm.revenueLines?.length > 0) detectedSections.push("REVENUE");
      if (norm.costLines?.length > 0) detectedSections.push("EXPENDITURE");

      await tx
        .update(smartImportRuns)
        .set({
          status: "COMMITTED",
          committedAt: new Date(),
          committedBy: userId,
          recordsAttempted: totalAttempted,
          recordsSucceeded: totalSucceeded,
          recordsFailed: totalFailed,
          importType: detectedSections.join(","),
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
        summary: `Import committed: ${counts.planTasks} tasks, ${counts.revenueLines} revenue, ${counts.costLines} cost, ${counts.executionPhases} phases${skippedOverrideFields.length > 0 ? ` (${skippedOverrideFields.length} manual override(s) preserved)` : ''}`,
        fileMetadata: { fileName: run.originalFileName, fileHash: run.fileHash },
        fields: importFields,
      });
    } catch (auditErr: any) {
      console.warn("[smart-import] Audit logging failed (non-blocking):", auditErr.message);
    }

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "commit",
      projectName: run.projectName,
      source: "IMPORT",
      changesJson: { counts, preservedOverrides: skippedOverrideFields.length, preservedManualEdits: preservedManualEditsCount },
    });

    res.json({
      success: true,
      runId,
      counts,
      preservedOverrides: skippedOverrideFields.length > 0 ? skippedOverrideFields : undefined,
      preservedManualEdits: preservedManualEditsCount > 0 ? preservedManualEditsCount : undefined,
    });
  } catch (err: any) {
    console.error("[smart-import] POST commit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/smart-import/:runId/rollback
router.post("/api/smart-import/:runId/rollback", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status !== "COMMITTED") {
      return res.status(400).json({ error: "Only committed imports can be rolled back" });
    }

    await db.transaction(async (tx: any) => {
      await tx.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.importRunId, runId));
      await tx.delete(normalizedCostLines).where(eq(normalizedCostLines.importRunId, runId));
      await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.importRunId, runId));

      const rollbackWis = await tx
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(
          eq(workItems.source, "SMART_IMPORT"),
          eq(workItems.workstream, "PM"),
          eq(workItems.importRunId, runId),
        ));
      if (rollbackWis.length > 0) {
        const wiIds = rollbackWis.map((w: any) => w.id);
        await tx.delete(workItemDependencies).where(
          or(
            inArray(workItemDependencies.predecessorId, wiIds),
            inArray(workItemDependencies.successorId, wiIds),
          )
        );
        await tx.delete(workItemAssignments).where(inArray(workItemAssignments.workItemId, wiIds));
        await tx.delete(workItems).where(inArray(workItems.id, wiIds));
      }

      await tx
        .update(smartImportRuns)
        .set({ status: "ROLLED_BACK" })
        .where(eq(smartImportRuns.id, runId));
    });

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "rollback",
      projectName: run.projectName,
      source: "IMPORT",
      changesJson: { previousStatus: run.status },
    });

    res.json({ success: true, runId, status: "ROLLED_BACK" });
  } catch (err: any) {
    console.error("[smart-import] POST rollback error:", err);
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

    const records = await db.select().from(workItems)
      .where(and(
        eq(workItems.importRunId, latestRun.id),
        eq(workItems.workstream, "PM"),
        eq(workItems.source, "SMART_IMPORT"),
      ));

    res.json(records.map(wi => ({
      id: wi.id,
      projectName: projectName,
      taskName: wi.title,
      taskNo: wi.wbsCode,
      phase: wi.phase,
      startDate: wi.startDate,
      endDate: wi.endDate,
      durationDays: wi.duration,
      owner: wi.ownerName,
      status: wi.status,
      pctComplete: wi.percentComplete,
      expectedPctComplete: wi.expectedPctComplete,
      isMilestone: wi.isMilestone,
      indentLevel: wi.indentLevel,
      sourceSheet: wi.sourceSheet,
      sourceRow: wi.sourceRow,
      importRunId: wi.importRunId,
    })));
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
router.post("/api/smart-import/bulk-commit", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
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
                  resolution: "ALLOW_ALL",
                  resolutionNote: "Auto-allowed during bulk commit",
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
          body: JSON.stringify({ acknowledgeManualEdits: true, forceCommit: true, acknowledgeEqualDate: true, forceRecreate: true }),
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

    logAuditFromReq(req, {
      entityType: "smart_import",
      action: "bulk_commit",
      source: "IMPORT",
      changesJson: { committed, failed, skipped, total: runs.length },
    });

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

router.get("/api/import-control-tower/history", requireAuth, requirePermission("admin", "view"), async (req: Request, res: Response) => {
  try {
    const importType = req.query.importType as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    const runs = await db
      .select()
      .from(smartImportRuns)
      .orderBy(desc(smartImportRuns.uploadedAt))
      .limit(Math.min(limit, 500));

    let filtered = runs;
    if (importType && importType !== "all") {
      filtered = filtered.filter(r => {
        const summary = r.summaryJson as any;
        if (!summary?.normalization) return false;
        const norm = summary.normalization;
        switch (importType) {
          case "plan": return norm.planTasks?.length > 0;
          case "cost": return norm.costLines?.length > 0;
          case "revenue": return norm.revenueLines?.length > 0;
          case "project": return summary.detection?.projectInfo != null;
          default: return true;
        }
      });
    }
    if (status && status !== "all") {
      filtered = filtered.filter(r => r.status === status);
    }

    const enriched = await Promise.all(filtered.map(async (run) => {
      const issues = await db.select().from(importIssues)
        .where(eq(importIssues.importRunId, run.id));

      const summary = run.summaryJson as any;
      const norm = summary?.normalization || {};
      const sections: string[] = [];
      if (norm.planTasks?.length > 0) sections.push("PLAN");
      if (norm.revenueLines?.length > 0) sections.push("REVENUE");
      if (norm.costLines?.length > 0) sections.push("EXPENDITURE");

      const attempted = (norm.planTasks?.length || 0) + (norm.revenueLines?.length || 0) + (norm.costLines?.length || 0);
      const failedIssues = issues.filter(i => i.severity === "BLOCKER" && !i.resolved);

      let uploaderName: string | null = null;
      if (run.uploadedBy) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, run.uploadedBy));
        uploaderName = u?.name || null;
      }

      return {
        id: run.id,
        projectName: run.projectName,
        projectId: run.projectId,
        sourceFileName: run.sourceFileName,
        status: run.status,
        uploadedAt: run.uploadedAt,
        committedAt: run.committedAt,
        uploadedBy: run.uploadedBy,
        uploaderName,
        recordsAttempted: run.recordsAttempted ?? attempted,
        recordsSucceeded: run.recordsSucceeded ?? (run.status === "COMMITTED" ? attempted - failedIssues.length : 0),
        recordsFailed: run.recordsFailed ?? failedIssues.length,
        importType: run.importType ?? sections.join(","),
        sections,
        totalIssues: issues.length,
        unresolvedBlockers: failedIssues.length,
        unresolvedWarnings: issues.filter(i => i.severity !== "BLOCKER" && !i.resolved).length,
        resolvedIssues: issues.filter(i => i.resolved).length,
      };
    }));

    res.json(enriched);
  } catch (err: any) {
    console.error("[import-control-tower] GET history error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/import-control-tower/run/:runId/errors", requireAuth, requirePermission("admin", "view"), async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const issues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    const enrichedIssues = issues.map(issue => ({
      id: issue.id,
      severity: issue.severity,
      section: issue.section,
      message: issue.message,
      suggestedAction: issue.suggestedAction,
      issueType: issue.issueType,
      resolved: issue.resolved,
      resolution: issue.resolution,
      resolutionNote: issue.resolutionNote,
      autoResolved: issue.autoResolved,
      resolvedAt: issue.resolvedAt,
      payloadJson: issue.payloadJson,
    }));

    res.json({
      runId,
      projectName: run.projectName,
      sourceFileName: run.sourceFileName,
      status: run.status,
      issues: enrichedIssues,
    });
  } catch (err: any) {
    console.error("[import-control-tower] GET run errors:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/import-control-tower/retry/:runId", requireAuth, requirePermission("admin", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status !== "FAILED" && run.status !== "ROLLED_BACK" && run.status !== "PREVIEW") {
      return res.status(400).json({ error: `Cannot retry import with status "${run.status}". Only FAILED, ROLLED_BACK, or PREVIEW runs can be retried.` });
    }

    await db.update(smartImportRuns)
      .set({ status: "PREVIEW" })
      .where(eq(smartImportRuns.id, runId));

    await db.update(importIssues)
      .set({ resolved: false, resolution: null, resolutionNote: null, resolvedBy: null, resolvedAt: null })
      .where(eq(importIssues.importRunId, runId));

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "retry",
      source: "IMPORT",
      changesJson: { previousStatus: run.status },
    });

    res.json({ success: true, runId, newStatus: "PREVIEW" });
  } catch (err: any) {
    console.error("[import-control-tower] POST retry error:", err);
    res.status(500).json({ error: err.message });
  }
});

export function registerSmartImportRoutes(app: Express) {
  app.use(router);
}
