// Smart Import API Routes
// Register in server/index.ts: import { registerSmartImportRoutes } from "./smart-import-routes"; registerSmartImportRoutes(app);

import { Express, Request, Response, NextFunction, Router } from "express";
import multer from "multer";
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
  // planEditNotifications, // Notifications feature removed
  projectRevenueSummary,
  programExpense,
  programInflows,
  expenseTaskLinks,
  cosStatusOverrides,
  users,
  importLogs,
  manualEditFlags,
  conflictResolutionLog,
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
  // Phase suffixes (ph1, phase 2, etc.) are PRESERVED to distinguish multi-phase projects
  n = n.replace(/\(\d+\)/g, "");
  n = n.replace(/\d{4}[-\/]\d{2}[-\/]\d{2}/g, "");
  n = n.replace(/\d{8,}/g, "");
  n = n.replace(/[^a-z0-9\s]/g, "");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Strips phase suffixes from a normalized name to get the base project name.
 * Used to detect same-project-different-phase scenarios.
 */
function stripPhase(normalized: string): string {
  return normalized.replace(/\b(ph\s*\d+|phase\s*\d+)\b/gi, "").replace(/\s+/g, " ").trim();
}

/**
 * Extracts the phase identifier from a normalized name (e.g., "ph2", "phase 1").
 * Returns null if no phase found.
 */
function extractPhase(normalized: string): string | null {
  const match = normalized.match(/\b(ph\s*\d+|phase\s*\d+)\b/i);
  return match ? match[1].replace(/\s+/g, "").toLowerCase() : null;
}

function computeSimilarity(a: string, b: string): { score: number; matchReason?: string } {
  if (a === b) return { score: 1.0 };
  if (!a || !b) return { score: 0 };

  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) return { score: 1.0 };
  if (!normA || !normB) return { score: 0 };

  // Phase-aware check: same base name but different phase number → medium confidence
  const baseA = stripPhase(normA);
  const baseB = stripPhase(normB);
  const phaseA = extractPhase(normA);
  const phaseB = extractPhase(normB);

  if (baseA === baseB && baseA.length > 0 && phaseA !== phaseB && (phaseA || phaseB)) {
    return { score: 0.7, matchReason: "same_project_different_phase" };
  }

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return { score: 0 };

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
    return { score: Math.max(0.85, tokenSimilarity, minLen / maxLen) };
  }

  return { score: Math.max(tokenSimilarity, prefixSimilarity) };
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

    const { score: sim, matchReason: phaseReason } = computeSimilarity(projectName, p.projectName);
    if (sim >= 0.5) {
      let reason = phaseReason || "fuzzy_match";
      if (!phaseReason) {
        if (sim >= 0.85) reason = "high_confidence_match";
        else if (sim >= 0.7) reason = "medium_confidence_match";
      }
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

/**
 * Prune old import runs in the DB: keep the current run + latest 2 committed runs as fallback.
 * Stale non-committed runs (PREVIEW/AWAITING_REVIEW/FAILED) are cleaned up.
 */
async function pruneOldImportRuns(projectName: string, currentRunId: number): Promise<void> {
  try {
    const runs = await db
      .select({ id: smartImportRuns.id, status: smartImportRuns.status })
      .from(smartImportRuns)
      .where(eq(smartImportRuns.projectName, projectName))
      .orderBy(desc(smartImportRuns.uploadedAt));

    const keepIds = new Set<number>([currentRunId]);
    let committedKept = 0;
    for (const run of runs) {
      if (run.status === "COMMITTED" && committedKept < 2) {
        keepIds.add(run.id);
        committedKept++;
      }
    }

    const idsToDelete = runs
      .filter((r) => !keepIds.has(r.id) && r.status !== "COMMITTED")
      .map((r) => r.id);

    if (idsToDelete.length > 0) {
      await db.delete(importIssues).where(inArray(importIssues.importRunId, idsToDelete));
      await db.delete(smartImportRuns).where(inArray(smartImportRuns.id, idsToDelete));
      console.log(`[SmartImport] Pruned ${idsToDelete.length} stale import runs for "${projectName}"`);
    }
  } catch (err: any) {
    console.warn(`[SmartImport] Failed to prune old import runs:`, err?.message || err);
  }
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isXlsx =
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.originalname.toLowerCase().endsWith(".xlsx") ||
      file.originalname.toLowerCase().endsWith(".xlsm");
    if (isXlsx) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only .xlsx files are accepted. Please convert your file to .xlsx format and try again."));
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
  upload.single("file")(req, res, async (err: any) => {
    if (err) {
      const message = err.message || "File upload failed";
      // Log rejected upload attempt
      try {
        const userId = (req as any).user?.id || null;
        await db.insert(importLogs).values({
          fileName: (req as any).file?.originalname || "unknown",
          importedByUserId: userId,
          importedByName: (req as any).user?.name || null,
          status: "REJECTED",
          errorMessage: message,
        });
      } catch (_) { /* non-blocking */ }
      return res.status(400).json({ error: message });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = req.file.originalname;
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : null;
    const buffer = req.file.buffer;

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

    // Prune old DB import runs: keep latest + one fallback per project
    await pruneOldImportRuns(run.projectName, run.id);

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

// GET /api/smart-import/health-dashboard — Import health across all projects
router.get("/api/smart-import/health-dashboard", requireAuth, requirePermission("smart_import", "view"), async (_req: Request, res: Response) => {
  try {
    // Get the latest committed run per project
    const allRuns = await db.select({
      id: smartImportRuns.id,
      projectName: smartImportRuns.projectName,
      projectId: smartImportRuns.projectId,
      status: smartImportRuns.status,
      committedAt: smartImportRuns.committedAt,
      uploadedAt: smartImportRuns.uploadedAt,
    })
      .from(smartImportRuns)
      .orderBy(sql`${smartImportRuns.committedAt} DESC NULLS LAST, ${smartImportRuns.uploadedAt} DESC`);

    // Aggregate per project
    const projectMap = new Map<string, {
      projectName: string;
      projectId: number | null;
      lastImportDate: string | null;
      lastImportStatus: string;
      totalImportRuns: number;
    }>();

    for (const run of allRuns) {
      if (!projectMap.has(run.projectName)) {
        projectMap.set(run.projectName, {
          projectName: run.projectName,
          projectId: run.projectId,
          lastImportDate: run.status === "COMMITTED" && run.committedAt ? run.committedAt.toISOString() : null,
          lastImportStatus: run.status,
          totalImportRuns: 0,
        });
      }
      const entry = projectMap.get(run.projectName)!;
      entry.totalImportRuns++;
      // Update last committed date if this is a committed run and we don't have one yet
      if (!entry.lastImportDate && run.status === "COMMITTED" && run.committedAt) {
        entry.lastImportDate = run.committedAt.toISOString();
        entry.lastImportStatus = "COMMITTED";
      }
    }

    // Get unresolved issue counts per project (from latest run only)
    const latestRunIds = new Map<string, number>();
    for (const run of allRuns) {
      if (!latestRunIds.has(run.projectName)) {
        latestRunIds.set(run.projectName, run.id);
      }
    }
    const issueCountMap = new Map<string, number>();
    for (const [projectName, latestRunId] of latestRunIds) {
      const unresolvedCount = await db.select({ count: sql<number>`count(*)` })
        .from(importIssues)
        .where(and(eq(importIssues.importRunId, latestRunId), eq(importIssues.resolved, false)));
      issueCountMap.set(projectName, Number(unresolvedCount[0]?.count || 0));
    }

    // Also include projects that have never been imported
    const allProjects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo);
    for (const proj of allProjects) {
      if (proj.projectName && !projectMap.has(proj.projectName)) {
        projectMap.set(proj.projectName, {
          projectName: proj.projectName,
          projectId: proj.id,
          lastImportDate: null,
          lastImportStatus: "NEVER",
          totalImportRuns: 0,
        });
      }
    }

    const now = new Date();
    const dashboard = Array.from(projectMap.values()).map(p => {
      const daysSinceLastImport = p.lastImportDate
        ? Math.floor((now.getTime() - new Date(p.lastImportDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const staleness: "fresh" | "aging" | "stale" | "never" =
        daysSinceLastImport === null ? "never" :
        daysSinceLastImport <= 14 ? "fresh" :
        daysSinceLastImport <= 30 ? "aging" : "stale";
      return {
        ...p,
        daysSinceLastImport,
        staleness,
        unresolvedIssueCount: issueCountMap.get(p.projectName) || 0,
      };
    });

    // Sort: stale first, then aging, fresh, never
    const stalenessOrder: Record<string, number> = { stale: 0, aging: 1, never: 2, fresh: 3 };
    dashboard.sort((a, b) => (stalenessOrder[a.staleness] ?? 9) - (stalenessOrder[b.staleness] ?? 9));

    res.json(dashboard);
  } catch (err: any) {
    console.error("[smart-import] GET health-dashboard error:", err);
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

// GET /api/smart-import/:runId/diff — Compute delta between incoming data and existing DB records
router.get("/api/smart-import/:runId/diff", requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    if (!summary?.normalization) return res.json({ diff: null });

    const norm = summary.normalization;
    const projectName = run.projectName;
    const projectId = run.projectId;

    const diff: Record<string, { added: number; modified: number; removed: number; unchanged: number; details: any[] }> = {};

    // Plan tasks diff
    if (Array.isArray(norm.planTasks) && norm.planTasks.length > 0) {
      const existingTasks = projectId
        ? await db.select({ title: workItems.title, startDate: workItems.startDate, endDate: workItems.endDate, ownerName: workItems.ownerName })
            .from(workItems)
            .where(and(eq(workItems.projectId, projectId), eq(workItems.source, "SMART_IMPORT")))
        : [];
      const existingMap = new Map<string, typeof existingTasks[number]>(existingTasks.map(t => [`${t.title}::${t.startDate || ""}`, t]));
      let added = 0, modified = 0, unchanged = 0;
      const details: any[] = [];
      const matchedKeys = new Set<string>();

      for (const task of norm.planTasks) {
        const key = `${task.taskName}::${task.startDate || ""}`;
        if (existingMap.has(key)) {
          matchedKeys.add(key);
          const existing = existingMap.get(key)!;
          const changes: string[] = [];
          if (task.endDate !== existing.endDate) changes.push(`endDate: ${existing.endDate || "—"} → ${task.endDate || "—"}`);
          if (task.owner !== existing.ownerName) changes.push(`owner: ${existing.ownerName || "—"} → ${task.owner || "—"}`);
          if (changes.length > 0) {
            modified++;
            if (details.length < 20) details.push({ type: "modified", name: task.taskName, changes });
          } else {
            unchanged++;
          }
        } else {
          added++;
          if (details.length < 20) details.push({ type: "added", name: task.taskName });
        }
      }
      const removed = existingTasks.length - matchedKeys.size;
      diff.plan = { added, modified, removed, unchanged, details };
    }

    // Revenue diff
    if (Array.isArray(norm.revenueLines) && norm.revenueLines.length > 0) {
      const existingRevenue = projectId
        ? await db.select({ milestoneName: normalizedRevenueLines.milestoneName, amountExVat: normalizedRevenueLines.amountExVat, invoiceNumber: normalizedRevenueLines.invoiceNumber })
            .from(normalizedRevenueLines)
            .where(eq(normalizedRevenueLines.projectId, projectId))
        : [];
      const existingMap = new Map<string, typeof existingRevenue[number]>(existingRevenue.map(r => [`${r.milestoneName}::${r.amountExVat || ""}`, r]));
      let added = 0, modified = 0, unchanged = 0;
      const details: any[] = [];
      const matchedKeys = new Set<string>();

      for (const line of norm.revenueLines) {
        const key = `${line.milestoneName}::${line.amountExVat || ""}`;
        if (existingMap.has(key)) {
          matchedKeys.add(key);
          const existing = existingMap.get(key)!;
          const changes: string[] = [];
          if ((line.invoiceNumber || null) !== (existing.invoiceNumber || null)) changes.push(`invoiceNumber: ${existing.invoiceNumber || "—"} → ${line.invoiceNumber || "—"}`);
          if (changes.length > 0) {
            modified++;
            if (details.length < 20) details.push({ type: "modified", name: line.milestoneName, changes });
          } else {
            unchanged++;
          }
        } else {
          added++;
          if (details.length < 20) details.push({ type: "added", name: line.milestoneName });
        }
      }
      const removed = existingRevenue.length - matchedKeys.size;
      diff.revenue = { added, modified, removed, unchanged, details };
    }

    // Cost lines diff
    if (Array.isArray(norm.costLines) && norm.costLines.length > 0) {
      const existingCost = projectId
        ? await db.select({ description: normalizedCostLines.description, amountExVat: normalizedCostLines.amountExVat, invoiceNumber: normalizedCostLines.invoiceNumber })
            .from(normalizedCostLines)
            .where(eq(normalizedCostLines.projectId, projectId))
        : [];
      const existingMap = new Map(existingCost.map(c => [`${c.description}::${c.amountExVat || ""}::${c.invoiceNumber || ""}`, c]));
      let added = 0, modified = 0, unchanged = 0;
      const details: any[] = [];
      const matchedKeys = new Set<string>();

      for (const line of norm.costLines) {
        const key = `${line.description}::${line.amountExVat || ""}::${line.invoiceNumber || ""}`;
        if (existingMap.has(key)) {
          matchedKeys.add(key);
          unchanged++;
        } else {
          added++;
          if (details.length < 20) details.push({ type: "added", name: line.description || line.costCategory });
        }
      }
      const removed = existingCost.length - matchedKeys.size;
      diff.cost = { added, modified: 0, removed, unchanged, details };
    }

    res.json({ diff });
  } catch (err: any) {
    console.error("[smart-import] GET diff error:", err);
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
    // Ensure DB columns exist before attempting any inserts
    await ensureSchemaReady();
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

      // Also check manualEditFlags for broader field-level conflicts
      const editFlags = await db.select().from(manualEditFlags)
        .where(and(
          eq(manualEditFlags.entityType, "program_expense"),
          eq(manualEditFlags.isProtected, false),
        ));

      // Build a lookup of who edited what
      const editFlagMap = new Map<string, { editedByName: string | null; editedAt: Date }>();
      for (const ef of editFlags) {
        editFlagMap.set(`${ef.entityId}::${ef.fieldName}`, {
          editedByName: ef.editedByName,
          editedAt: ef.editedAt,
        });
      }

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
          editedByName?: string;
          editedAt?: string;
        }> = [];

        for (const existing of manuallyModifiedRows) {
          const matchingImport = importCostLines.find((imp: any) => imp.sourceRow === existing.sourceRow);

          // COS Realized: requires BOTH invoice number AND black font invoice date
          // Non-black font = not confirmed = NOT realized
          if (existing.cosRealised) {
            const importHasInvoice = matchingImport?.invoiceNumber && matchingImport.invoiceNumber.trim();
            const importDateConfirmed = matchingImport?.invoiceDateConfirmed === true;
            const importCos = importHasInvoice && importDateConfirmed;
            const flagInfo = editFlagMap.get(`${existing.id}::invoiceDateConfirmed`);
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "COS Realised",
              currentValue: "Yes (manually confirmed)",
              importValue: importCos ? "Yes" : "No (invoice not black or missing)",
              editedByName: flagInfo?.editedByName || undefined,
              editedAt: flagInfo?.editedAt?.toISOString() || undefined,
            });
          }
          if (existing.invoiceDateConfirmed) {
            const flagInfo = editFlagMap.get(`${existing.id}::invoiceDateConfirmed`);
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Invoice Date Confirmed",
              currentValue: "Yes (manually confirmed)",
              importValue: matchingImport?.invoiceDateConfirmed ? "Yes" : "No",
              editedByName: flagInfo?.editedByName || undefined,
              editedAt: flagInfo?.editedAt?.toISOString() || undefined,
            });
          }
          // Payment date: non-black = not happened yet
          if (existing.paidDateConfirmed) {
            const flagInfo = editFlagMap.get(`${existing.id}::paidDateConfirmed`);
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Paid Date Confirmed",
              currentValue: "Yes (manually confirmed — payment received)",
              importValue: matchingImport?.paidDateConfirmed ? "Yes" : "No (not black — payment not received)",
              editedByName: flagInfo?.editedByName || undefined,
              editedAt: flagInfo?.editedAt?.toISOString() || undefined,
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
            const flagInfo = editFlagMap.get(`${existing.id}::cashflowConfirmed`);
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Cashflow Confirmed",
              currentValue: "Yes (manually confirmed)",
              importValue: matchingImport?.cashflowConfirmed ? "Yes" : "No",
              editedByName: flagInfo?.editedByName || undefined,
              editedAt: flagInfo?.editedAt?.toISOString() || undefined,
            });
          }
        }

        return res.status(409).json({
          error: "manual_edits_warning",
          message: `This project has ${manuallyModifiedRows.length} cost line(s) with manual edits that will be affected by this import.`,
          manualEditCount: manuallyModifiedRows.length,
          changeSetCount,
          conflicts,
          hint: "Resolve each conflict individually: 'keep' to preserve your manual edit, 'import' to overwrite with Excel data.",
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

    // Notifications feature removed - planEditNotifications governance check disabled
    // Previously blocked import commits when unresolved front-end plan edits existed.

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
              subProjectName: merged.subProjectName || null,
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
              subProjectName: merged.subProjectName || null,
            };
          });
        if (revValues.length > 0) {
          await tx.insert(normalizedRevenueLines).values(revValues);
        }
        counts.revenueLines = revValues.length;
      }

      if (Array.isArray(norm.revenueLines) && projectName) {
        const oldInflows = await tx.select({
          rowNumber: programInflows.rowNumber,
          inBank: programInflows.inBank,
          milestoneName: programInflows.milestoneName,
          milestoneAmount: programInflows.milestoneAmount,
        })
          .from(programInflows)
          .where(eq(programInflows.projectName, projectName));

        // Build composite key map: "milestoneName::amount" → { inBank, rowNumber }
        const oldCompositeMap = new Map<string, { inBank: number | null; rowNumber: number | null }>();
        const oldRowMap = new Map<number, number | null>();
        for (const r of oldInflows) {
          if (r.rowNumber != null) oldRowMap.set(r.rowNumber, r.inBank);
          if (r.milestoneName) {
            const key = `${r.milestoneName}::${r.milestoneAmount || ""}`;
            oldCompositeMap.set(key, { inBank: r.inBank, rowNumber: r.rowNumber });
          }
        }

        await tx.delete(programInflows).where(eq(programInflows.projectName, projectName));
        if (norm.revenueLines.length > 0) {
          const revIgnored = ignoredRows.get("REVENUE") || new Set();
          const revOverrides = overrideRows.get("REVENUE") || new Map();
          let milestoneIdx = 0;
          const piValues = norm.revenueLines
            .filter((r: any) => !revIgnored.has(r.sourceRow))
            .map((r: any) => {
              const ov = revOverrides.get(r.sourceRow);
              const m = ov ? { ...r, ...ov } : r;
              milestoneIdx++;
              const name = m.milestoneName || m.description || null;
              const amount = m.amountExVat ? String(m.amountExVat) : null;

              // Composite match first (name + amount), then fall back to row number
              let prevInBank: number | null | undefined = undefined;
              const compositeKey = name ? `${name}::${amount || ""}` : null;
              if (compositeKey && oldCompositeMap.has(compositeKey)) {
                const match = oldCompositeMap.get(compositeKey)!;
                prevInBank = match.inBank;
                // Warn if the milestone moved rows
                if (match.rowNumber != null && match.rowNumber !== r.sourceRow) {
                  console.log(`[SmartImport] Revenue milestone '${name}' moved from row ${match.rowNumber} to row ${r.sourceRow}. Status preserved.`);
                }
              }
              // Fall back to row number match
              if (prevInBank === undefined && oldRowMap.has(r.sourceRow)) {
                prevInBank = oldRowMap.get(r.sourceRow) ?? null;
              }

              return {
                projectName,
                rowNumber: r.sourceRow,
                milestoneNo: String(milestoneIdx),
                milestoneName: name,
                milestoneAmount: amount,
                plannedPaymentDate: m.expectedPaymentDate || null,
                milestoneInvoiceNumber: m.invoiceNumber || null,
                invoiceRaisedDate: m.invoiceDate || null,
                paymentReceivedDate: m.paidDate || null,
                inBank: prevInBank != null ? prevInBank : (m.inBankDate ? 1 : 0),
                subProjectName: m.subProjectName || null,
                dataSource: "SMART_IMPORT",
                projectId: projectId || null,
                importRunId: runId,
              };
            });
          if (piValues.length > 0) {
            await tx.insert(programInflows).values(piValues);
            console.log(`[SmartImport] Wrote ${piValues.length} program_inflows rows for "${projectName}"`);
          }
        }
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
              budgetQty: merged.budgetQty || null,
              budgetRate: merged.budgetRate || null,
              budgetTotal: merged.budgetTotal || null,
              budgetCos: merged.budgetCos || null,
              revenueRecognitionAmount: merged.revenueRecognitionAmount || null,
              forecastPaymentDate: merged.forecastPaymentDate || null,
              subProjectName: merged.subProjectName || null,
              _actualCos: merged.actualCos || null,
            };
          });
        if (costValues.length > 0) {
          const normalizedInserts = costValues.map((c: any) => {
            const { _actualCos, ...normalized } = c;
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

      if (Array.isArray(norm.costLines) && projectName) {
        const oldPeRows = await tx.select({ id: programExpense.id, rowNumber: programExpense.rowNumber })
          .from(programExpense)
          .where(eq(programExpense.projectName, projectName));

        await tx.delete(programExpense).where(eq(programExpense.projectName, projectName));

        const toStr = (v: any): string | null => v != null ? String(v) : null;
        if (norm.costLines.length > 0) {
          const costIgnored = ignoredRows.get("EXPENDITURE") || new Set();
          const costOverrides = overrideRows.get("EXPENDITURE") || new Map();
          let currentCategory = "";
          const peValues = norm.costLines
            .filter((c: any) => !costIgnored.has(c.sourceRow))
            .map((c: any) => {
              const ov = costOverrides.get(c.sourceRow);
              const m = ov ? { ...c, ...ov } : c;
              if (m.costCategory && m.costCategory !== currentCategory) currentCategory = m.costCategory;
              return {
                projectName,
                rowNumber: c.sourceRow,
                rowType: "item" as const,
                expenseCategory: currentCategory || m.costCategory || null,
                expenseLineItem: m.description || null,
                budgetQty: toStr(m.budgetQty),
                budgetRateUnit: toStr(m.budgetRate),
                budgetTotal: toStr(m.budgetTotal),
                budgetCosTotal: toStr(m.budgetCos),
                forecastPaymentDate: m.forecastPaymentDate || null,
                expenseActualTotal: toStr(m.amountExVat),
                expensePoNumber: m.poNumber || null,
                expenseInvoiceNumber: m.invoiceNumber || null,
                expenseInvoicedDate: m.invoiceDate || null,
                invoiceDateFontColor: m.invoiceDateFontColor || null,
                invoiceDateConfirmed: m.invoiceDateFontColor === "black",
                expensePaymentDate: m.paidDate || null,
                paymentDateFontColor: m.paidDateFontColor || null,
                paymentDateConfirmed: m.paidDateFontColor === "black",
                subProjectName: m.subProjectName || null,
                dataSource: "SMART_IMPORT",
                projectId: projectId || null,
                importRunId: runId,
              };
            });
          if (peValues.length > 0) {
            await tx.insert(programExpense).values(peValues);
            console.log(`[SmartImport] Wrote ${peValues.length} program_expense rows for "${projectName}"`);
          }
        }

        const newPeRows = await tx.select({ id: programExpense.id, rowNumber: programExpense.rowNumber })
          .from(programExpense)
          .where(eq(programExpense.projectName, projectName));
        const newIdByRow = new Map(newPeRows.filter(r => r.rowNumber != null).map(r => [r.rowNumber!, r.id]));
        const newIdSet = new Set(newPeRows.map(r => r.id));

        const existingLinks = await tx.select().from(expenseTaskLinks)
          .where(eq(expenseTaskLinks.projectName, projectName));
        for (const link of existingLinks) {
          const oldRow = oldPeRows.find(r => r.id === link.expenseId);
          if (oldRow && oldRow.rowNumber != null) {
            const newId = newIdByRow.get(oldRow.rowNumber);
            if (newId && newId !== link.expenseId) {
              await tx.update(expenseTaskLinks).set({ expenseId: newId }).where(eq(expenseTaskLinks.id, link.id));
            } else if (!newId) {
              await tx.delete(expenseTaskLinks).where(eq(expenseTaskLinks.id, link.id));
            }
          } else if (!newIdSet.has(link.expenseId)) {
            await tx.delete(expenseTaskLinks).where(eq(expenseTaskLinks.id, link.id));
          }
        }

        const existingCosOverrides = await tx.select().from(cosStatusOverrides)
          .where(eq(cosStatusOverrides.projectName, projectName));
        for (const co of existingCosOverrides) {
          const oldRow = oldPeRows.find(r => r.id === co.expenseId);
          if (oldRow && oldRow.rowNumber != null) {
            const newId = newIdByRow.get(oldRow.rowNumber);
            if (newId && newId !== co.expenseId) {
              await tx.update(cosStatusOverrides).set({ expenseId: newId }).where(eq(cosStatusOverrides.id, co.id));
            } else if (!newId) {
              await tx.delete(cosStatusOverrides).where(eq(cosStatusOverrides.id, co.id));
            }
          } else if (!newIdSet.has(co.expenseId)) {
            await tx.delete(cosStatusOverrides).where(eq(cosStatusOverrides.id, co.id));
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

      if (norm.costedSummary && projectName) {
        const cs = norm.costedSummary;
        const hasData = cs.plannedRevenue != null || cs.plannedExpenditure != null;
        if (hasData) {
          const [existing] = await tx.select({ id: projectRevenueSummary.id })
            .from(projectRevenueSummary)
            .where(eq(projectRevenueSummary.projectName, projectName))
            .limit(1);
          const vals: Record<string, any> = {};
          if (cs.plannedRevenue != null) vals.plannedRevenue = String(cs.plannedRevenue);
          if (cs.plannedExpenditure != null) vals.plannedExpenditure = String(cs.plannedExpenditure);
          if (cs.plannedProfit != null) vals.plannedProfit = String(cs.plannedProfit);
          if (cs.plannedMargin != null) vals.plannedMargin = String(cs.plannedMargin);
          if (cs.actualRevenue != null) vals.actualRevenue = String(cs.actualRevenue);
          if (cs.actualExpenditure != null) vals.actualExpenditure = String(cs.actualExpenditure);
          if (cs.actualProfit != null) vals.actualProfit = String(cs.actualProfit);
          if (cs.actualMargin != null) vals.actualMargin = String(cs.actualMargin);
          if (existing) {
            await tx.update(projectRevenueSummary).set(vals).where(eq(projectRevenueSummary.id, existing.id));
          } else {
            await tx.insert(projectRevenueSummary).values({ projectName, ...vals } as any);
          }
          console.log(`[SmartImport] Saved costedSummary for "${projectName}":`, JSON.stringify(vals));
        }
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

    // Step 4.5: Log conflict resolution decisions and manage protected fields
    if (hasConflictResolutions && conflictResolutions) {
      try {
        for (const [key, decision] of Object.entries(conflictResolutions)) {
          const [sourceRowStr, fieldLabel] = key.split("::");
          const sourceRow = parseInt(sourceRowStr);
          if (isNaN(sourceRow)) continue;

          await db.insert(conflictResolutionLog).values({
            importRunId: runId,
            entityType: "normalized_cost_line",
            entityId: `${projectName || ''}|row${sourceRow}`,
            fieldName: fieldLabel || "unknown",
            manualValue: decision === "keep" ? "preserved" : null,
            importValue: decision === "import" ? "applied" : null,
            decision: decision === "keep" ? "KEEP_MANUAL" : "OVERWRITE_WITH_IMPORT",
            decidedByUserId: userId,
            decidedByName: (req as any).user?.name || null,
          });

          // Manage manual edit flags based on decision
          if (decision === "keep") {
            // Mark field as protected — future imports must resolve conflict again
            await db.update(manualEditFlags)
              .set({
                isProtected: true,
                protectedAt: new Date(),
                protectedByUserId: userId,
              })
              .where(and(
                eq(manualEditFlags.entityType, "program_expense"),
                eq(manualEditFlags.fieldName, fieldLabel || ""),
              ));
          } else {
            // Clear the manual edit flag — field returns to normal import behaviour
            await db.delete(manualEditFlags)
              .where(and(
                eq(manualEditFlags.entityType, "program_expense"),
                eq(manualEditFlags.fieldName, fieldLabel || ""),
              ));
          }
        }
      } catch (resLogErr: any) {
        console.warn("[smart-import] Conflict resolution logging failed (non-blocking):", resLogErr.message);
      }
    }

    logAuditFromReq(req, {
      entityType: "smart_import",
      entityId: String(runId),
      action: "commit",
      projectName: run.projectName,
      source: "IMPORT",
      changesJson: { counts, preservedOverrides: skippedOverrideFields.length, preservedManualEdits: preservedManualEditsCount },
    });

    // Build complete import summary
    const totalAttempted = (norm.planTasks?.length || 0) + (norm.revenueLines?.length || 0) + (norm.costLines?.length || 0) + (norm.executionPhases?.length || 0);
    const totalWritten = (counts.planTasks || 0) + (counts.revenueLines || 0) + (counts.costLines || 0) + (counts.executionPhases || 0);
    const totalSkipped = totalAttempted - totalWritten;

    const importSummary = {
      fileName: run.sourceFileName || run.originalFileName || "unknown",
      timestamp: new Date().toISOString(),
      rowsWritten: totalWritten,
      rowsSkipped: totalSkipped,
      conflictsDetected: skippedOverrideFields.length,
      conflictsResolved: hasConflictResolutions ? Object.keys(conflictResolutions!).length : 0,
      counts,
    };

    // Write structured import log (Step 3.3)
    try {
      await db.insert(importLogs).values({
        importRunId: runId,
        fileName: importSummary.fileName,
        importedByUserId: userId,
        importedByName: (req as any).user?.name || null,
        projectName: projectName || null,
        status: totalWritten > 0 ? (totalSkipped > 0 ? "PARTIAL" : "SUCCESS") : "FAILED",
        rowsAttempted: totalAttempted,
        rowsWritten: totalWritten,
        rowsSkipped: totalSkipped,
        rowsRejected: 0,
        conflictsDetected: skippedOverrideFields.length,
        conflictsResolved: importSummary.conflictsResolved,
        summaryJson: importSummary as any,
      });
    } catch (logErr: any) {
      console.warn("[smart-import] Import log write failed (non-blocking):", logErr.message);
    }

    res.json({
      success: true,
      runId,
      summary: importSummary,
      counts,
      preservedOverrides: skippedOverrideFields.length > 0 ? skippedOverrideFields : undefined,
      preservedManualEdits: preservedManualEditsCount > 0 ? preservedManualEditsCount : undefined,
    });
  } catch (err: any) {
    console.error("[smart-import] POST commit error:", err);

    // Log failed import attempt
    try {
      const userId = (req as any).user?.id || null;
      const runId = parseInt(req.params.runId as string);
      if (!isNaN(runId)) {
        const [failedRun] = await db.select({ fileName: smartImportRuns.sourceFileName, projectName: smartImportRuns.projectName })
          .from(smartImportRuns).where(eq(smartImportRuns.id, runId)).limit(1);
        await db.insert(importLogs).values({
          importRunId: runId,
          fileName: failedRun?.fileName || "unknown",
          importedByUserId: userId,
          importedByName: (req as any).user?.name || null,
          projectName: failedRun?.projectName || null,
          status: "FAILED",
          errorMessage: err.message,
        });
      }
    } catch (_) { /* non-blocking */ }

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
    // Ensure DB columns exist before attempting any inserts
    await ensureSchemaReady();
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

// Promise that resolves once program_expense/program_inflows columns are verified.
// Awaited by the commit handler to prevent race conditions on startup.
let schemaReadyPromise: Promise<void> = Promise.resolve();

export function ensureSchemaReady(): Promise<void> {
  return schemaReadyPromise;
}

export function registerSmartImportRoutes(app: Express) {
  app.use(router);

  // Ensure program_expense and program_inflows have all required columns.
  // These are additive ALTER TABLE statements (safe to re-run).
  schemaReadyPromise = (async () => {
    try {
      const { getDbMode } = await import("./db");
      if (getDbMode() === "sqlite") return;
      const { sql: rawSql } = await import("drizzle-orm");
      await db.execute(rawSql.raw(`
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_qty NUMERIC(12,4);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_rate_unit NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_total NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS budget_cos_total NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS forecast_payment_date TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_qty NUMERIC(12,4);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_rate_unit NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_actual_total NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_po_number TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_invoice_number TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_invoiced_date TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS invoice_date_confirmed BOOLEAN DEFAULT FALSE;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS invoice_date_font_color TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_payment_date TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS payment_date_confirmed BOOLEAN DEFAULT FALSE;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS payment_date_font_color TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS actual_cos_total NUMERIC(15,2);
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS line_status TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS expense_line_hash TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS computed_state TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS computed_forecast_payment_date TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS supplier_name TEXT;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'SMART_IMPORT';
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS project_id INTEGER;
        ALTER TABLE program_expense ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
        ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS sub_project_name TEXT;
        ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'SMART_IMPORT';
        ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS project_id INTEGER;
        ALTER TABLE program_inflows ADD COLUMN IF NOT EXISTS import_run_id INTEGER;
      `));
      console.log("[SmartImport] Ensured program_expense/program_inflows columns exist");
    } catch (e: any) {
      console.warn("[SmartImport] Column check skipped:", e?.message?.slice(0, 80));
    }
  })();
}
