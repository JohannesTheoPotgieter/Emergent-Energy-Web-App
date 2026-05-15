// Smart Import API Routes
// Register in server/index.ts: import { registerSmartImportRoutes } from "./smart-import-routes"; registerSmartImportRoutes(app);

import { Express, Request, Response, NextFunction, Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { z } from "zod";
import { validateBody } from "./middleware/validateBody";
import { logAuditFromReq } from "./audit-logger";
import { parseIntParam } from "./lib/req-params";

// Zod schemas for smart-import write surface.
// passthrough() keeps existing unknown keys flowing during the initial
// rollout; tighten to strict() in a follow-up once traffic confirms usage.
const conflictDecisionEnum = z.enum(["keep_app", "accept_file"]);
const moneyImpactBodySchema = z
  .object({ decisions: z.record(z.string(), conflictDecisionEnum).optional() })
  .passthrough();
const commitBodySchema = z
  .object({
    forceCommit: z.boolean().optional(),
    acknowledgeEqualDate: z.boolean().optional(),
    acknowledgeManualEdits: z.boolean().optional(),
    preserveManualEdits: z.boolean().optional(),
    v2ConflictResolutions: z.record(z.string(), conflictDecisionEnum).optional(),
  })
  .passthrough();
import { db } from "./db";
import { requirePermission, hasImportPermission } from "./permission-middleware";
import { jwtAuth, requireAuth } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
import { runSmartImportPreview } from "./lib/import/index";
import { runPreflightValidator } from "./lib/import/preflight-validator";
import { runImportPlanner, type PlannerResult } from "./lib/import/planner";
import { writePlanIncremental, writeRevenueIncremental, writeExpenditureIncremental, writeActualLineRows, writeProjectMetadata, writeRevenueSummary, mergeConflictsToWizardRows, type IncrementalCommitResult } from "./lib/import/commit-executor";
import { newImportMetrics, emitImportMetrics, threeWayMergeEnabled } from "./lib/import/feature-flags";
import { matchRows, generateBusinessKey, type SectionType, type MatchedRow } from "./lib/import/row-matcher";
import { runConflictEngine, type RowMergeResult } from "./lib/import/conflict-engine";
import { loadCurrentPlanRows, loadCurrentRevenueRows, loadCurrentCostRows, loadBaselineForPlanner, detectImportMode } from "./lib/import/baseline";
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
  auditEvents,
  workItems,
  workItemAssignments,
  workItemDependencies,
  // planEditNotifications, // Notifications feature removed
  projectRevenueSummary,
  expenseTaskLinks,
  users,
  importLogs,
  manualEditFlags,
  conflictResolutionLog,
  categoryRevenueAllocations,
} from "@shared/schema";
import { normalizeCategoryKey } from "./lib/import/normalizer";
import { normalizeCostLineStatus, normalizeAllocationConfidence } from "./lib/import/utils";
import { materializeDerivatives } from "./lib/import/derivative-materializer";
import { syncProjectSplitTables, syncProjectSplitTablesAfterInsert } from "./lib/project-info-sync";
import { softCloseByProjectId, softCloseByProjectName, softCloseByImportRunId, addTemporalColumns, dedupeCostLineInserts } from "./lib/temporal-helpers";
import { recordImportChange, recordSystemEvent } from "./lib/audit/diff-engine";
import { refreshProjectMetricsAsync } from "./services/dashboard-metrics";
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
      if (run.status === "committed" && committedKept < 2) {
        keepIds.add(run.id);
        committedKept++;
      }
    }

    const idsToDelete = runs
      .filter((r: any) => !keepIds.has(r.id) && r.status !== "committed")
      .map((r: any) => r.id);

    if (idsToDelete.length > 0) {
      await db.delete(importIssues).where(inArray(importIssues.importRunId, idsToDelete));
      await db.delete(smartImportRuns).where(inArray(smartImportRuns.id, idsToDelete));
      console.log(`[SmartImport] Pruned ${idsToDelete.length} stale import runs for "${projectName}"`);
    }
  } catch (err: unknown) {
    console.warn(`[SmartImport] Failed to prune old import runs:`, (err as any)?.message || err);
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
  limits: { fileSize: 50 * 1024 * 1024, files: 5 },
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

router.use(jwtAuth);

router.get("/api/smart-import/runs", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    // project_id surfaced so the UI can deep-link to the per-project Tracker
    // replicas (Revenue Tracking / Expenditure Breakdown / Program Plan) for
    // post-import data-integrity verification.
    const rows = await db.execute(sql`
      SELECT id, project_id, project_name, status, source_file_name as file_name,
             uploaded_at, committed_at, uploaded_by, committed_by
      FROM smart_import_runs
      ORDER BY uploaded_at DESC
      LIMIT 100
    `);
    const results = Array.isArray(rows) ? rows : (rows.rows || []);
    res.json(results);
  } catch (err: unknown) {
    console.error("[SmartImport] List runs error:", err);
    res.status(500).json({ error: "Failed to list import runs" });
  }
});

// POST /api/smart-import/upload
router.post("/api/smart-import/upload", requireAuth, requirePermission("smart_import", "edit"), (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, async (err: any) => {
    if (err) {
      const message = (err instanceof Error ? err.message : String(err)) || "File upload failed";
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
      requiresUserConfirmation: projectMatches.length > 0 && !autoMappedProjectId && projectMatches.some(m => m.confidence >= 0.75),
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

    try {
      const preflight = runPreflightValidator(
        resolvedProjectId,
        (preview as any)?.normalization?.planTasks ?? [],
      );
      (preview as any).preflight = preflight;
      if (preflight.warnings.length > 0) {
        console.log(
          `[SmartImport] Preflight: ${preflight.warnings.length} warnings ` +
            `(dup=${preflight.counts.duplicatePlannedRefs}, ` +
            `blankMs=${preflight.counts.blankOutlineMilestones}, ` +
            `missingCoord=${preflight.counts.missingSourceCoordinates})`,
        );
      }
    } catch (preflightErr) {
      console.warn(`[SmartImport] Preflight validator failed (non-fatal):`, preflightErr);
    }

    const [run] = await db
      .insert(smartImportRuns)
      .values({
        projectId: resolvedProjectId,
        projectName: autoMappedProjectId && bestMatch ? bestMatch.projectName : projectName,
        uploadedBy: userId,
        sourceFileName: fileName,
        sourceFileHash: fileHash,
        status: "preview",
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
  } catch (err: unknown) {
    console.error("[smart-import] POST upload error:", (err instanceof Error ? err.message : String(err)));
    let userMessage = (err instanceof Error ? err.message : String(err)) || "Unknown error";
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
router.get("/api/smart-import/history/:projectName", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const runs = await db
      .select()
      .from(smartImportRuns)
      .where(eq(smartImportRuns.projectName, projectName))
      .orderBy(desc(smartImportRuns.uploadedAt));

    res.json(runs);
  } catch (err: unknown) {
    console.error("[smart-import] GET history error:", err);
    throw err;
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
          lastImportDate: run.status === "committed" && run.committedAt ? run.committedAt.toISOString() : null,
          lastImportStatus: run.status,
          totalImportRuns: 0,
        });
      }
      const entry = projectMap.get(run.projectName)!;
      entry.totalImportRuns++;
      // Update last committed date if this is a committed run and we don't have one yet
      if (!entry.lastImportDate && run.status === "committed" && run.committedAt) {
        entry.lastImportDate = run.committedAt.toISOString();
        entry.lastImportStatus = "committed";
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
  } catch (err: unknown) {
    console.error("[smart-import] GET health-dashboard error:", err);
    throw err;
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
      .where(eq(smartImportRuns.status, "preview"))
      .orderBy(smartImportRuns.projectName);

    const latestByProject = new Map<string, typeof runs[0]>();
    const duplicateIds: number[] = [];
    for (const run of runs) {
      const key = `${run.projectName ?? "unknown"}::${run.sourceFileName}`;
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
          .set({ status: "superseded" })
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

    runsWithIssues.sort((a, b) => (a.projectName || "").localeCompare(b.projectName || ""));
    res.json(runsWithIssues);
  } catch (err: unknown) {
    console.error("[smart-import] GET pending-runs error:", err);
    throw err;
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
  } catch (err: unknown) {
    console.error("[smart-import] GET project-matches error:", err);
    throw err;
  }
});

router.patch("/api/smart-import/:runId/assign-project", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
  } catch (err: unknown) {
    console.error("[smart-import] PATCH assign-project error:", err);
    throw err;
  }
});

// GET /api/smart-import/:runId
// Optional query param: ?includePlan=true to include v2 planner output
router.get("/api/smart-import/:runId", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const issues = await db.select().from(importIssues).where(eq(importIssues.importRunId, runId));

    let planning: PlannerResult | null = null;
    if (req.query.includePlan === "true") {
      const summary = run.summaryJson as any;
      if (summary?.normalization) {
        try {
          planning = await runImportPlanner(run.projectId, summary.normalization);
        } catch (planErr: unknown) {
          console.warn("[SmartImport] Planner failed (non-blocking):", (planErr instanceof Error ? planErr.message : String(planErr)));
        }
      }
    }

    res.json({
      run,
      issues,
      preview: run.summaryJson,
      planning,
    });
  } catch (err: unknown) {
    console.error("[smart-import] GET run error:", err);
    throw err;
  }
});

// GET /api/smart-import/:runId/diff — Compute delta between incoming data and existing DB records
router.get("/api/smart-import/:runId/diff", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
      const existingMap = new Map<string, typeof existingTasks[number]>(existingTasks.map((t: any) => [`${t.title}::${t.startDate || ""}`, t]));
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
            .where(and(eq(normalizedRevenueLines.projectId, projectId), and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))))
        : [];
      const existingMap = new Map<string, typeof existingRevenue[number]>(existingRevenue.map((r: any) => [`${r.milestoneName}::${r.amountExVat || ""}`, r]));
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
            .where(and(eq(normalizedCostLines.projectId, projectId), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))))
        : [];
      const existingMap = new Map(existingCost.map((c: any) => [`${c.description}::${c.amountExVat || ""}::${c.invoiceNumber || ""}`, c]));
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
  } catch (err: unknown) {
    console.error("[smart-import] GET diff error:", err);
    throw err;
  }
});

// GET /api/smart-import/:runId/plan — Smart Import v2 planner output
// Returns structured diff with row-level classifications:
//   NEW / CHANGED / UNCHANGED / MISSING_FROM_UPLOAD / CONFLICT_PLACEHOLDER
router.get("/api/smart-import/:runId/plan", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });
    console.log(`[smart-import] GET plan start: runId=${runId}`);
    const t0 = Date.now();

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    if (!summary?.normalization) {
      return res.status(400).json({ error: "No normalization data found in this import run" });
    }

    const timeoutMs = 30000;
    const plannerPromise = runImportPlanner(run.projectId, summary.normalization);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Planner timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    const planning = await Promise.race([plannerPromise, timeoutPromise]);
    console.log(`[smart-import] GET plan done: runId=${runId} in ${Date.now() - t0}ms`);

    res.json({ planning });
  } catch (err: unknown) {
    console.error("[smart-import] GET plan error:", err);
    throw err;
  }
});

// GET /api/smart-import/:runId/qb-protections
// Returns a summary of what QuickBooks precedence will protect on this run:
// - Whether the gate is enabled
// - How many active QB-linked cost / revenue lines exist on the resolved project
// - Which fields are locked from spreadsheet overrides
// Used by the Smart Import v2 flow to show the user, before they commit, what
// will and will NOT be touched on linked rows.
router.get("/api/smart-import/:runId/qb-protections", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  const runId = parseIntParam(req.params.runId);
  if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

  const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
  if (!run) return res.status(404).json({ error: "Import run not found" });

    const { isQbPrecedenceEnabled } = await import("./lib/import/qb-precedence");
    const enabled = await isQbPrecedenceEnabled();

    let costLinkedCount = 0;
    let revenueLinkedCount = 0;

    if (run.projectId) {
      // Count active QB-linked cost lines for this project. We join via the
      // links table so we count *active* links (deleted_at IS NULL) pointing
      // at *active* snapshot rows (effective_to IS NULL, deleted_at IS NULL).
      const { quickbooksInvoiceLinks } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

      const [costRow] = await db.execute(sqlTag`
        SELECT COUNT(DISTINCT ncl.id)::int AS n
        FROM ${normalizedCostLines} ncl
        INNER JOIN ${quickbooksInvoiceLinks} ql
          ON ql.app_entity_type = 'cost_line'
         AND ql.app_entity_id = ncl.id
         AND ql.deleted_at IS NULL
        WHERE ncl.project_id = ${run.projectId}
          AND ncl.effective_to IS NULL
          AND ncl.deleted_at IS NULL
      `) as any;
      costLinkedCount = Number(costRow?.n ?? costRow?.rows?.[0]?.n ?? 0);

      const [revRow] = await db.execute(sqlTag`
        SELECT COUNT(DISTINCT nrl.id)::int AS n
        FROM ${normalizedRevenueLines} nrl
        INNER JOIN ${quickbooksInvoiceLinks} ql
          ON ql.app_entity_type = 'revenue_line'
         AND ql.app_entity_id = nrl.id
         AND ql.deleted_at IS NULL
        WHERE nrl.project_id = ${run.projectId}
          AND nrl.effective_to IS NULL
          AND nrl.deleted_at IS NULL
      `) as any;
      revenueLinkedCount = Number(revRow?.n ?? revRow?.rows?.[0]?.n ?? 0);
    }

    res.json({
      enabled,
      projectId: run.projectId,
      costLinkedCount,
      revenueLinkedCount,
      // Only fields the precedence engine actually locks today. paidDate /
      // inBankDate are inferred from QB payment events (not flat columns)
      // and therefore left untouched on linked rows for now — promising
      // them here would mislead operators.
      lockedFields: [
        "amountExVat", "vat", "invoiceNumber", "invoiceDate",
      ],
      protections: {
        autoRealiseOnQbPaid: true,
        preserveLinkedRowsMissingFromUpload: true,
      logsVariancesToAudit: true,
    },
  });
});

// POST /api/smart-import/:runId/money-impact
// Pre-commit financial dry-run aligned with commit-executor semantics.
//
// Body (optional):
//   { decisions?: Record<string, "keep_app" | "accept_file"> }
//   keys are `${rowUid}::${fieldName}` — same shape the UI builds on the
//   Decision step. We honour decisions for `amountExVat` so a `keep_app`
//   choice zeroes that row's contribution to changedDelta.
//
// For REVENUE and EXPENDITURE we classify each row the way commit-executor
// will and sum the resulting amount-ex-vat impact:
//
//   newTotal              sum(file.amount) for NEW rows
//   changedDelta          sum(file.amount - db.amount) for CHANGED rows
//                          (rows whose amount conflict was resolved with
//                           keep_app contribute 0)
//   qbBlockedDelta        subset of changedDelta whose amount move WOULD
//                          be undone by QuickBooks precedence (gate on +
//                          row is QB-linked). The UI subtracts this from
//                          the headline net change.
//   missingRemovedTotal   sum(db.amount) of MISSING rows that commit-
//                          executor will soft-close (non-QB-linked). These
//                          REDUCE the active book — included in net change.
//   missingPreservedTotal sum(db.amount) of MISSING rows that survive the
//                          import (QB-linked rows are preserved by
//                          commit-executor's MISSING pre-pass). NOT part
//                          of net change — shown for context.
//
// Net change per side = newTotal + changedDelta − qbBlockedDelta − missingRemovedTotal.
// All amounts are in ZAR. NULL/blank amounts are treated as 0.
router.post("/api/smart-import/:runId/money-impact", requireAuth, requirePermission("smart_import", "view"), validateBody(moneyImpactBodySchema), async (req: Request, res: Response) => {
  const runId = parseIntParam(req.params.runId);
  if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const decisions: Record<string, "keep_app" | "accept_file"> =
      (req.body && typeof req.body.decisions === "object" && req.body.decisions !== null)
        ? req.body.decisions
        : {};

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    if (!summary?.normalization) {
      return res.status(400).json({ error: "No normalization data found in this import run" });
    }

    const { isQbPrecedenceEnabled } = await import("./lib/import/qb-precedence");
    const qbOn = await isQbPrecedenceEnabled();

    const projectId = run.projectId;

    const toNum = (v: any): number => {
      if (v == null || v === "") return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const blankImpact = () => ({
      newTotal: 0,
      changedDelta: 0,
      qbBlockedDelta: 0,
      missingPreservedTotal: 0,
      missingRemovedTotal: 0,
      newCount: 0,
      changedCount: 0,
      missingPreservedCount: 0,
      missingRemovedCount: 0,
      qbBlockedCount: 0,
      keptByDecisionCount: 0,
    });

    const revenueImpact = blankImpact();
    const costImpact = blankImpact();

    // BASELINE / no project resolved → everything is NEW from the file side.
    if (!projectId) {
      const fileRev = (summary.normalization?.revenueLines ?? []) as Record<string, any>[];
      const fileCost = (summary.normalization?.costLines ?? []) as Record<string, any>[];
      for (const r of fileRev) { revenueImpact.newCount++; revenueImpact.newTotal += toNum(r.amountExVat); }
      for (const r of fileCost) { costImpact.newCount++; costImpact.newTotal += toNum(r.amountExVat); }
      return res.json({
        currency: "ZAR", qbPrecedenceEnabled: qbOn, projectId: null,
        revenue: revenueImpact, cost: costImpact,
        revenueNetChange: revenueImpact.newTotal,
        costNetChange: costImpact.newTotal,
      });
    }

    // INCREMENTAL — load current rows + a single batched QB-link map per
    // section to avoid N+1 lookups in the row loop.
    const [revRows, costRows] = await Promise.all([
      loadCurrentRevenueRows(projectId),
      loadCurrentCostRows(projectId),
    ]);

    const { quickbooksInvoiceLinks } = await import("@shared/schema");
    const { inArray, isNull, and: dAnd } = await import("drizzle-orm");

    async function loadLinkedIdSet(
      appEntityType: "revenue_line" | "cost_line",
      ids: number[],
    ): Promise<Set<number>> {
      if (ids.length === 0) return new Set();
      const rows = await db
        .select({ appEntityId: quickbooksInvoiceLinks.appEntityId })
        .from(quickbooksInvoiceLinks)
        .where(dAnd(
          eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
          inArray(quickbooksInvoiceLinks.appEntityId, ids),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ));
      return new Set(rows.map((r: any) => r.appEntityId));
    }

    const [revLinkedIds, costLinkedIds] = await Promise.all([
      loadLinkedIdSet("revenue_line", (revRows as any[]).map(r => r.id)),
      loadLinkedIdSet("cost_line", (costRows as any[]).map(r => r.id)),
    ]);

    const fileRev = (summary.normalization?.revenueLines ?? []) as Record<string, any>[];
    const fileCost = (summary.normalization?.costLines ?? []) as Record<string, any>[];

    type Sec = {
      type: SectionType;
      fileRows: Record<string, any>[];
      existingRows: Array<Record<string, any> & { id: number }>;
      acc: ReturnType<typeof blankImpact>;
      linked: Set<number>;
    };
    const sections: Sec[] = [
      { type: "REVENUE", fileRows: fileRev, existingRows: revRows as any, acc: revenueImpact, linked: revLinkedIds },
      { type: "EXPENDITURE", fileRows: fileCost, existingRows: costRows as any, acc: costImpact, linked: costLinkedIds },
    ];

    for (const sec of sections) {
      const matched = matchRows(sec.type, projectId, sec.fileRows, sec.existingRows);
      for (const mr of matched) {
        switch (mr.classification) {
          case "NEW": {
            sec.acc.newCount++;
            sec.acc.newTotal += toNum(mr.fileRow?.amountExVat);
            break;
          }
          case "CHANGED": {
            sec.acc.changedCount++;
            const fileAmt = toNum(mr.fileRow?.amountExVat);
            const dbAmt = toNum(mr.existingRow?.amountExVat);
            const rawDelta = fileAmt - dbAmt;

            // Honour user decisions: rowUid::amountExVat == keep_app means
            // commit-executor will not write the amount, so this row's
            // contribution to changed-delta is zero.
            const amountDecisionKey = `${mr.rowUid ?? mr.businessKey.key}::amountExVat`;
            const keptByUser = decisions[amountDecisionKey] === "keep_app";
            if (keptByUser) {
              sec.acc.keptByDecisionCount++;
              break;
            }

            sec.acc.changedDelta += rawDelta;

            // QB precedence will lock amount on linked rows. Use the
            // pre-loaded set instead of a per-row lookup.
            if (qbOn && rawDelta !== 0 && mr.existingRowId != null && sec.linked.has(mr.existingRowId)) {
              sec.acc.qbBlockedCount++;
              sec.acc.qbBlockedDelta += rawDelta;
            }
            break;
          }
          case "MISSING_FROM_UPLOAD": {
            const amt = toNum(mr.existingRow?.amountExVat);
            // commit-executor's MISSING pre-pass only suppresses soft-close
            // when the QB precedence gate is ON. With the gate off, even
            // QB-linked rows get soft-closed — i.e. removed from the
            // active book. Mirror that here so net change matches reality.
            const isLinked = mr.existingRowId != null && sec.linked.has(mr.existingRowId);
            const willBePreserved = qbOn && isLinked;
            if (willBePreserved) {
              sec.acc.missingPreservedCount++;
              sec.acc.missingPreservedTotal += amt;
            } else {
              sec.acc.missingRemovedCount++;
              sec.acc.missingRemovedTotal += amt;
            }
            break;
          }
          // UNCHANGED / CONFLICT_PLACEHOLDER → no money movement
        }
      }
    }

    res.json({
      currency: "ZAR",
      qbPrecedenceEnabled: qbOn,
      projectId,
      revenue: revenueImpact,
      cost: costImpact,
      revenueNetChange:
        revenueImpact.newTotal + revenueImpact.changedDelta
      - revenueImpact.qbBlockedDelta - revenueImpact.missingRemovedTotal,
    costNetChange:
      costImpact.newTotal + costImpact.changedDelta
      - costImpact.qbBlockedDelta - costImpact.missingRemovedTotal,
  });
});

// GET /api/smart-import/:runId/integrity-check
// B4a — Invoice / PO integrity report.
//
// Cheap, in-memory validation over `summary.normalization`. Surfaces
// problems the user should know about BEFORE they commit:
//
//   DUPLICATE_INVOICE_IN_SECTION  same invoice number reused inside the
//                                 same section (revenue or cost).
//   CROSS_SECTION_INVOICE         same invoice number on a cost AND a
//                                 revenue row — invoices are either
//                                 incoming or outgoing, never both.
//   INVOICE_WITHOUT_AMOUNT        invoice number present but amount is 0
//                                 or blank (suspicious: invoiced for
//                                 nothing).
//   PAID_WITHOUT_INVOICE          paid date set but no invoice number
//                                 (paid before invoiced — likely typo).
//   PO_COUNTERPARTY_CONFLICT      same PO number across cost rows pointing
//                                 to different counterparties.
//
// Severity: WARNING for everything (advisory). The endpoint never blocks
// commit on its own — operators decide.
//
// Note: this is intentionally separate from `import_issues` (which is the
// persisted blocker / acknowledgement table). This is a fresh dry-run on
// the parsed file so it stays accurate even if persisted issues are stale.
router.get("/api/smart-import/:runId/integrity-check", requireAuth, requirePermission("smart_import", "view"), async (req: Request, res: Response) => {
  const runId = parseIntParam(req.params.runId);
  if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

  const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
  if (!run) return res.status(404).json({ error: "Import run not found" });

    const summary = run.summaryJson as any;
    const norm = summary?.normalization;
    if (!norm) {
      return res.status(400).json({ error: "No normalization data found in this import run" });
    }

    type Severity = "INFO" | "WARNING" | "BLOCKER";
    interface Finding {
      kind: string;
      severity: Severity;
      section: "REVENUE" | "EXPENDITURE" | "CROSS";
      message: string;
      rows: number[]; // 1-indexed sourceRow values where the issue occurs
      detail?: Record<string, unknown>;
    }
    const findings: Finding[] = [];

    const revLines = (norm.revenueLines ?? []) as Array<Record<string, any>>;
    const costLines = (norm.costLines ?? []) as Array<Record<string, any>>;

    // Use the same placeholder filter the normalizer uses so we don't fire
    // duplicate-invoice / cross-section warnings on TBC, N/A, "0" etc.
    const { isValidInvoiceNumber } = await import("./lib/import/normalizer");
    const norm_inv = (s: any): string | null => {
      if (!isValidInvoiceNumber(s as any)) return null;
      return String(s).trim().toUpperCase();
    };
    const toNum = (v: any): number => {
      if (v == null || v === "") return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const srcRow = (r: any, fallbackIdx: number): number =>
      typeof r?.sourceRow === "number" ? r.sourceRow : fallbackIdx + 1;

    // --- 1. Duplicate invoice number within section -----------------------
    function dupesIn(section: "REVENUE" | "EXPENDITURE", rows: Array<Record<string, any>>) {
      const groups = new Map<string, number[]>();
      rows.forEach((r, i) => {
        const inv = norm_inv(r.invoiceNumber);
        if (!inv) return;
        const arr = groups.get(inv) ?? [];
        arr.push(srcRow(r, i));
        groups.set(inv, arr);
      });
      for (const [inv, srcRows] of groups) {
        if (srcRows.length > 1) {
          findings.push({
            kind: "DUPLICATE_INVOICE_IN_SECTION",
            severity: "WARNING",
            section,
            message: `Invoice number "${inv}" appears ${srcRows.length} times in ${section === "REVENUE" ? "revenue" : "expenditure"}.`,
            rows: srcRows,
            detail: { invoiceNumber: inv, occurrences: srcRows.length },
          });
        }
      }
    }
    dupesIn("REVENUE", revLines);
    dupesIn("EXPENDITURE", costLines);

    // --- 2. Cross-section invoice collision ------------------------------
    // Group by invoice number so each clashing invoice produces one
    // finding (not one per cost row). Prevents quadratic payload growth on
    // collision-heavy files.
    {
      const revInvIndex = new Map<string, number[]>();
      revLines.forEach((r, i) => {
        const inv = norm_inv(r.invoiceNumber);
        if (!inv) return;
        const arr = revInvIndex.get(inv) ?? [];
        arr.push(srcRow(r, i));
        revInvIndex.set(inv, arr);
      });
      const costInvIndex = new Map<string, number[]>();
      costLines.forEach((r, i) => {
        const inv = norm_inv(r.invoiceNumber);
        if (!inv) return;
        const arr = costInvIndex.get(inv) ?? [];
        arr.push(srcRow(r, i));
        costInvIndex.set(inv, arr);
      });
      for (const [inv, costRows] of costInvIndex) {
        const revRows = revInvIndex.get(inv);
        if (!revRows || revRows.length === 0) continue;
        const allRows = Array.from(new Set([...costRows, ...revRows])).sort((a, b) => a - b);
        findings.push({
          kind: "CROSS_SECTION_INVOICE",
          severity: "WARNING",
          section: "CROSS",
          message: `Invoice number "${inv}" is used on both cost (${costRows.length}) and revenue (${revRows.length}) rows.`,
          rows: allRows,
          detail: { invoiceNumber: inv, costRows, revenueRows: revRows },
        });
      }
    }

    // --- 3. Invoice number with no amount --------------------------------
    function invoiceNoAmount(section: "REVENUE" | "EXPENDITURE", rows: Array<Record<string, any>>) {
      const offenders: number[] = [];
      const samples: Array<{ row: number; invoice: string }> = [];
      rows.forEach((r, i) => {
        const inv = norm_inv(r.invoiceNumber);
        if (!inv) return;
        if (toNum(r.amountExVat) === 0) {
          const sr = srcRow(r, i);
          offenders.push(sr);
          if (samples.length < 5) samples.push({ row: sr, invoice: inv });
        }
      });
      if (offenders.length > 0) {
        findings.push({
          kind: "INVOICE_WITHOUT_AMOUNT",
          severity: "WARNING",
          section,
          message: `${offenders.length} ${section === "REVENUE" ? "revenue" : "expenditure"} row${offenders.length === 1 ? "" : "s"} have an invoice number but no amount.`,
          rows: offenders,
          detail: { count: offenders.length, samples },
        });
      }
    }
    invoiceNoAmount("REVENUE", revLines);
    invoiceNoAmount("EXPENDITURE", costLines);

    // --- 4. Paid without invoice -----------------------------------------
    function paidNoInvoice(section: "REVENUE" | "EXPENDITURE", rows: Array<Record<string, any>>) {
      // Revenue rows track inBankDate as the "received" signal; cost rows
      // track paidDate as "paid out". Either should imply an invoice number.
      //
      // NOTE: norm_inv() returns null for both blank values AND placeholder
      // tokens like "TBC" / "N/A". For *this* rule that is intentional —
      // a paid row whose invoice column says "TBC" is precisely the kind of
      // anomaly the user wants surfaced (money moved without a real invoice
      // captured), so we treat placeholders as missing here.
      const offenders: number[] = [];
      rows.forEach((r, i) => {
        const inv = norm_inv(r.invoiceNumber);
        if (inv) return;
        const paidLike = section === "REVENUE" ? (r.inBankDate ?? r.paidDate) : r.paidDate;
        if (paidLike) offenders.push(srcRow(r, i));
      });
      if (offenders.length > 0) {
        findings.push({
          kind: "PAID_WITHOUT_INVOICE",
          severity: "WARNING",
          section,
          message: `${offenders.length} ${section === "REVENUE" ? "revenue" : "expenditure"} row${offenders.length === 1 ? "" : "s"} have a ${section === "REVENUE" ? "received" : "paid"} date but no invoice number.`,
          rows: offenders,
          detail: { count: offenders.length },
        });
      }
    }
    paidNoInvoice("REVENUE", revLines);
    paidNoInvoice("EXPENDITURE", costLines);

    // --- 5. PO counterparty conflict (cost only) -------------------------
    {
      const byPo = new Map<string, Map<string, number[]>>(); // po -> counterparty -> rows
      costLines.forEach((r, i) => {
        const po = norm_inv(r.poNumber);
        if (!po) return;
        const cp = (r.counterpartyName ?? "").toString().trim().toUpperCase() || "(blank)";
        if (!byPo.has(po)) byPo.set(po, new Map());
        const inner = byPo.get(po)!;
        const arr = inner.get(cp) ?? [];
        arr.push(srcRow(r, i));
        inner.set(cp, arr);
      });
      for (const [po, byCp] of byPo) {
        if (byCp.size > 1) {
          const counterparties = Array.from(byCp.keys());
          const allRows: number[] = [];
          for (const rs of byCp.values()) allRows.push(...rs);
          findings.push({
            kind: "PO_COUNTERPARTY_CONFLICT",
            severity: "WARNING",
            section: "EXPENDITURE",
            message: `PO "${po}" is used by ${byCp.size} different counterparties: ${counterparties.join(", ")}.`,
            rows: allRows.sort((a, b) => a - b),
            detail: { poNumber: po, counterparties, rowsByCounterparty: Object.fromEntries(byCp) },
          });
        }
      }
    }

    // --- Summary ---------------------------------------------------------
    const severityCounts = { INFO: 0, WARNING: 0, BLOCKER: 0 };
    for (const f of findings) severityCounts[f.severity]++;

    res.json({
      runId,
    totalCount: findings.length,
    severityCounts,
    findings,
  });
});

// PATCH /api/smart-import/:runId/project-info
router.patch("/api/smart-import/:runId/project-info", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
  } catch (err: unknown) {
    console.error("[smart-import] PATCH project-info error:", err);
    throw err;
  }
});

// PATCH /api/smart-import/:runId/mapping
router.patch("/api/smart-import/:runId/mapping", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
  } catch (err: unknown) {
    console.error("[smart-import] PATCH mapping error:", err);
    throw err;
  }
});

// PATCH /api/smart-import/:runId/issue/:issueId/resolve
router.patch("/api/smart-import/:runId/issue/:issueId/resolve", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    const issueId = parseIntParam(req.params.issueId);
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
  } catch (err: unknown) {
    console.error("[smart-import] PATCH resolve error:", err);
    throw err;
  }
});

// POST /api/smart-import/:runId/ignore-all-blockers
router.post("/api/smart-import/:runId/ignore-all-blockers", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
  } catch (err: unknown) {
    console.error("[smart-import] POST ignore-all-blockers error:", err);
    throw err;
  }
});

// POST /api/smart-import/:runId/allow-all
router.post("/api/smart-import/:runId/allow-all", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
  } catch (err: unknown) {
    console.error("[smart-import] POST allow-all error:", err);
    throw err;
  }
});

// POST /api/smart-import/:runId/apply-prior-resolutions
router.post("/api/smart-import/:runId/apply-prior-resolutions", requireAuth, requirePermission("smart_import", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
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
  } catch (err: unknown) {
    console.error("[smart-import] POST apply-prior-resolutions error:", err);
    throw err;
  }
});

// POST /api/smart-import/:runId/commit
router.post("/api/smart-import/:runId/commit", requireAuth, requirePermission("smart_import", "approve"), validateBody(commitBodySchema), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status === "committed") {
      return res.status(400).json({ error: "This import has already been committed" });
    }

    // Import recency enforcement
    const lastCommitted = await db
      .select()
      .from(smartImportRuns)
      .where(and(
        eq(smartImportRuns.projectName, run.projectName),
        eq(smartImportRuns.status, "committed")
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

    // ── Smart Import v2: 3-way conflict check ──
    // Run the planner to detect true conflicts (both app and file diverged from baseline).
    // Unresolved conflicts block commit.
    const v2ConflictResolutions = req.body?.v2ConflictResolutions as Record<string, "keep_app" | "accept_file"> | undefined;
    const preserveManualEditsEarly = req.body?.preserveManualEdits === true;

    if (!preserveManualEditsEarly && run.projectId) {
      const summary = run.summaryJson as any;
      if (summary?.normalization) {
        try {
          const plannerResult = await runImportPlanner(run.projectId, summary.normalization);
          if (plannerResult.conflicts?.hasBlockingConflicts) {
            const unresolvedConflicts = plannerResult.conflicts.allRows
              .filter(r => r.conflictStatus === "HAS_CONFLICTS")
              .map(r => ({
                rowKey: r.rowKey,
                displayLabel: r.displayLabel,
                section: r.section,
                canonicalSource: r.canonicalSource,
                fields: r.fields.filter(f => f.requiresDecision).map(f => ({
                  fieldName: f.fieldName,
                  baselineValue: f.baselineValue,
                  currentAppValue: f.currentAppValue,
                  uploadedValue: f.uploadedValue,
                  mergeCase: f.mergeCase,
                })),
              }));

            // Check if all conflicts have been resolved by the client
            const allResolved = v2ConflictResolutions
              ? unresolvedConflicts.every(r =>
                  r.fields.every(f => v2ConflictResolutions[`${r.rowKey}::${f.fieldName}`])
                )
              : false;

            if (!allResolved) {
              return res.status(409).json({
                error: "v2_conflicts_detected",
                message: `This import has ${unresolvedConflicts.length} row(s) where both the app and file changed differently from the last import. Please resolve each conflict.`,
                conflicts: unresolvedConflicts,
                planning: {
                  importMode: plannerResult.importMode,
                  warnings: plannerResult.warnings,
                },
                hint: "Resolve conflicts via v2ConflictResolutions: { 'rowKey::fieldName': 'keep_app' | 'accept_file' }",
              });
            }
          }
        } catch (planErr: unknown) {
          console.warn("[SmartImport] v2 conflict check failed (continuing without planner-based conflict gate):", (planErr instanceof Error ? planErr.message : String(planErr)));
        }
      }
    }

    const acknowledgeManualEdits = req.body?.acknowledgeManualEdits === true;
    const preserveManualEdits = preserveManualEditsEarly;
    const conflictResolutions = req.body?.conflictResolutions as Record<string, "keep" | "import"> | undefined;

    const hasConflictResolutions = conflictResolutions && Object.keys(conflictResolutions).length > 0;

    if (!acknowledgeManualEdits && !preserveManualEdits && !hasConflictResolutions && run.projectId) {
      const existingCostLines = await db.select().from(normalizedCostLines)
        .where(and(eq(normalizedCostLines.projectId, run.projectId), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))));

      const manuallyModifiedRows = existingCostLines.filter((row: any) =>
        row.cosRealised === true ||
        row.invoiceDateConfirmed === true ||
        row.paidDateConfirmed === true ||
        row.noRevenueLinked === true ||
        row.cashflowConfirmed === true ||
        !!row.adminDateOverride
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

          // COS Realised: invoice number is the ONLY hard check (canonical rule).
          // If a supplier invoice is captured, COS is realised.
          if (existing.cosRealised) {
            const importHasInvoice = matchingImport?.invoiceNumber && matchingImport.invoiceNumber.trim();
            const importCos = !!importHasInvoice;
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
          if (existing.adminDateOverride) {
            const flagInfo = editFlagMap.get(`${existing.id}::adminDateOverride`);
            const importDate = matchingImport?.forecastPaymentDate || matchingImport?.paidDate || "none";
            conflicts.push({
              sourceRow: existing.sourceRow || 0,
              description: existing.description || "",
              costCategory: existing.costCategory || "",
              field: "Admin Date Override",
              currentValue: `${existing.adminDateOverride}${existing.adminDateOverrideReason ? ` (${existing.adminDateOverrideReason})` : ""}`,
              importValue: importDate,
              editedByName: flagInfo?.editedByName || undefined,
              editedAt: flagInfo?.editedAt?.toISOString() || existing.adminDateOverrideAt?.toISOString() || undefined,
            });
          }
        }

        // Also check for revenue admin date overrides
        const existingRevLines = await db.select().from(normalizedRevenueLines)
          .where(and(eq(normalizedRevenueLines.projectId, run.projectId), and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))));

        const revWithOverrides = existingRevLines.filter((row: any) => !!row.adminDateOverride);
        if (revWithOverrides.length > 0) {
          const importRevLines = norm?.revenueLines || [];
          for (const existing of revWithOverrides) {
            if (existing.sourceRow == null) continue;
            const matchingImport = importRevLines.find((imp: any) => imp.sourceRow === existing.sourceRow);
            const importDate = matchingImport?.expectedPaymentDate || matchingImport?.paidDate || "none";
            conflicts.push({
              sourceRow: existing.sourceRow,
              description: existing.milestoneName || existing.description || "",
              costCategory: "Revenue",
              field: "Admin Date Override (Revenue)",
              currentValue: `${existing.adminDateOverride}${existing.adminDateOverrideReason ? ` (${existing.adminDateOverrideReason})` : ""}`,
              importValue: importDate,
              editedByName: undefined,
              editedAt: existing.adminDateOverrideAt?.toISOString() || undefined,
            });
          }
        }

        const totalEdits = manuallyModifiedRows.length + revWithOverrides.length;
        return res.status(409).json({
          error: "manual_edits_warning",
          message: `This project has ${totalEdits} line(s) with manual edits that will be affected by this import.`,
          manualEditCount: totalEdits,
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
          const significantMatches = closeMatches.filter(m => m.confidence >= 0.75);
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
        const newProjectFields = {
          projectName,
          phase: detectedInfo?.phase || "PLANNING",
          sizeKwp: detectedInfo?.sizeKwp || null,
          pd: detectedInfo?.pd || null,
          contractValue: detectedInfo?.contractValue || null,
        };
        const [newProject] = await db.insert(projectInfo).values(newProjectFields as any).returning();
        await syncProjectSplitTablesAfterInsert(newProject.id, newProjectFields);
        projectId = newProject.id;
        await db.update(smartImportRuns).set({ projectId }).where(eq(smartImportRuns.id, runId));
      }
    }

    if (!projectId) {
      return res.status(400).json({
        error: "project_id_missing",
        message: "Smart Import requires a resolved project_info.id before commit. Ensure the upsert pass ran first.",
      });
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
    const overwriteWarnings: string[] = [];
    let v2Result: IncrementalCommitResult | null = null;

    let preservedManualEditsCount = 0;

    // ── Preflight: external_ref collision check ──
    // Before opening the commit transaction, run the PLAN matcher and
    // verify every canonical external_ref the commit will write is either
    // unclaimed or already held by the row the matcher says should own it.
    // Any mismatch is a strong signal that the matcher and DB state have
    // drifted (legacy `#idxN` refs, concurrent modification, etc.). We do
    // NOT abort here — the executor's self-id fallback (`#pk<ownId>`) will
    // still resolve the write safely — but we log a diagnostic so ops can
    // see the drift without trawling failed commits.
    if (projectId) {
      try {
        const norm = (run.summaryJson as any)?.normalization;
        if (norm?.planTasks?.length) {
          const existingPlanRows = await loadCurrentPlanRows(projectId);
          const preflightMatches = matchRows("PLAN" as SectionType, projectId, norm.planTasks, existingPlanRows as any);
          const writeTargets: Array<{ row: typeof preflightMatches[number]; ref: string }> = [];
          for (const m of preflightMatches) {
            if (m.classification === "UNCHANGED" || m.classification === "MISSING_FROM_UPLOAD") continue;
            if (!m.canonicalExternalRef) continue;
            writeTargets.push({ row: m, ref: m.canonicalExternalRef });
          }
          if (writeTargets.length > 0) {
            const refSet = Array.from(new Set(writeTargets.map(w => w.ref)));
            // Batch-fetch all rows whose external_ref is in the target set.
            const held = await db
              .select({ id: workItems.id, externalRef: workItems.externalRef })
              .from(workItems)
              .where(and(
                inArray(workItems.externalRef, refSet),
                isNull(workItems.deletedAt),
              ));
            const holderByRef = new Map<string, number>();
            for (const h of held) {
              if (h.externalRef) holderByRef.set(h.externalRef, h.id);
            }
            const collisions: Array<{ ref: string; expectedId: number | null; holderId: number }> = [];
            for (const wt of writeTargets) {
              const holderId = holderByRef.get(wt.ref);
              if (holderId == null) continue;
              // Expected owner is the existing matched DB id (for CHANGED)
              // or null (for NEW — it should be unowned).
              const expected = wt.row.existingRowId;
              if (expected !== holderId) {
                collisions.push({ ref: wt.ref, expectedId: expected, holderId });
              }
            }
            if (collisions.length > 0) {
              console.warn(
                `[SmartImport] Preflight: ${collisions.length} PLAN external_ref collision(s) detected on run ${runId}. ` +
                `The executor self-id fallback will rewrite to #pk<ownId> form. Drift details:`,
                collisions.slice(0, 10),
              );
            }
          }
        }
      } catch (preflightErr) {
        // Preflight is purely diagnostic; never block a commit because of it.
        console.warn(
          "[SmartImport] Preflight collision check failed (non-blocking):",
          preflightErr instanceof Error ? preflightErr.message : String(preflightErr),
        );
      }
    }

    await db.transaction(async (tx: any) => {
      // ── Atomic commit guard ──
      // Claim this run for commit by atomically transitioning from a committable
      // status. If another request already committed (or the status is no longer
      // committable), the UPDATE matches 0 rows and we abort.
      // This prevents the race condition where two concurrent requests both read
      // status=PREVIEW outside the transaction and both proceed to commit.
      const claimResult = await tx.execute(sql`
        UPDATE smart_import_runs
        SET status = 'awaiting_review'
        WHERE id = ${runId}
          AND status IN ('preview', 'awaiting_review')
        RETURNING id
      `);
      const claimed = (claimResult.rows ?? claimResult);
      if (!claimed || claimed.length === 0) {
        throw Object.assign(new Error("Import run is no longer committable (already committed, rolled back, or superseded)"), { status: 409 });
      }

      // ── Smart Import v2: Incremental commit path ──
      // projectId is guaranteed resolved (fail-fast above). Use the
      // planner+conflict engine to perform targeted writes instead of
      // section-wide replace.
      const commitTimestamp = new Date();
      const baselineInfo = await detectImportMode(projectId);

      // Load current state for matching
      const [planRows, revenueRows, costRows, baselineNorm] = await Promise.all([
        loadCurrentPlanRows(projectId),
        loadCurrentRevenueRows(projectId),
        loadCurrentCostRows(projectId),
        baselineInfo.importMode === "INCREMENTAL" ? loadBaselineForPlanner(projectId) : Promise.resolve(null),
      ]);

      // Run row matching per section
      const matchedPlan = norm.planTasks?.length > 0 || planRows.length > 0
        ? matchRows("PLAN" as SectionType, projectId, norm.planTasks || [], planRows as any) : [];
      // Workbook-is-truth guard: only run the matcher when the FILE has
      // rows for the section. If the upload doesn't contain a Revenue or
      // Expenditure sheet at all, we skip the section entirely so existing
      // active rows are NOT classified as MISSING_FROM_UPLOAD and wiped.
      // (The new MISSING soft-close policy in the executor only fires when
      // the file legitimately drops a row from a populated section.)
      const matchedRevenue = (norm.revenueLines?.length ?? 0) > 0
        ? matchRows("REVENUE" as SectionType, projectId, norm.revenueLines || [], revenueRows as any) : [];
      const matchedCost = (norm.costLines?.length ?? 0) > 0
        ? matchRows("EXPENDITURE" as SectionType, projectId, norm.costLines || [], costRows as any) : [];

      // Run 3-way conflict engine for incremental imports
      let conflictMergeResults = new Map<string, RowMergeResult>();
      if (baselineInfo.importMode === "INCREMENTAL") {
        const conflictResult = runConflictEngine(
          { PLAN: matchedPlan, REVENUE: matchedRevenue, EXPENDITURE: matchedCost },
          baselineNorm,
          projectId,
          generateBusinessKey,
        );
        for (const row of conflictResult.allRows) {
          conflictMergeResults.set(row.rowKey, row);
        }
      }

      const v2Decisions = v2ConflictResolutions || {};

      // ── S11: Pre-import work_items snapshot ──
      // Capture current work_items state BEFORE v2 overwrites them in-place.
      // Required for state-restoring rollback (S21).
      if (planRows.length > 0) {
        try {
          const snapshotRows = planRows.map((r: any) => ({
            id: r.id, taskName: r.taskName, taskNo: r.taskNo, phase: r.phase,
            startDate: r.startDate, endDate: r.endDate, durationDays: r.durationDays,
            actualStartDate: r.actualStartDate, actualEndDate: r.actualEndDate,
            actualDurationDays: r.actualDurationDays, owner: r.owner,
            status: r.status, pctComplete: r.pctComplete,
            expectedPctComplete: r.expectedPctComplete, comment: r.comment,
            isMilestone: r.isMilestone, parentTaskNo: r.parentTaskNo,
            subProjectName: r.subProjectName, importRunId: r.importRunId,
          }));
          await tx.update(smartImportRuns)
            .set({ preImportSnapshot: snapshotRows })
            .where(eq(smartImportRuns.id, runId));
        } catch (snapErr: unknown) {
          console.warn("[SmartImport] Pre-import snapshot failed (non-blocking):", (snapErr instanceof Error ? snapErr.message : String(snapErr)));
        }
      }

      // Write PLAN incrementally
      let planResult = null;
      if (matchedPlan.length > 0) {
        planResult = await writePlanIncremental({
          tx, projectId, projectName, runId, userId,
          matchedRows: matchedPlan,
          mergeResults: conflictMergeResults,
          conflictDecisions: v2Decisions,
          workItemsTable: workItems,
          workItemDependenciesTable: workItemDependencies,
          workItemAssignmentsTable: workItemAssignments,
        });
        counts.planTasks = planResult.counts.inserted + planResult.counts.updated;
      }

      // Write REVENUE incrementally
      let revenueResult = null;
      if (matchedRevenue.length > 0) {
        revenueResult = await writeRevenueIncremental({
          tx, projectId, projectName, runId, userId,
          matchedRows: matchedRevenue,
          mergeResults: conflictMergeResults,
          conflictDecisions: v2Decisions,
          commitTimestamp,
        });
        counts.revenueLines = revenueResult.counts.inserted + revenueResult.counts.updated;
      }

      // Write EXPENDITURE incrementally
      let costResult = null;
      if (matchedCost.length > 0) {
        costResult = await writeExpenditureIncremental({
          tx, projectId, projectName, runId, userId,
          matchedRows: matchedCost,
          mergeResults: conflictMergeResults,
          conflictDecisions: v2Decisions,
          commitTimestamp,
        });
        counts.costLines = costResult.counts.inserted + costResult.counts.updated;
      }

      // ── Engine consolidation Phase 1 ──
      // The pre-commit `runImportPlanner` (conflict-engine.ts, summaryJson
      // baseline) already 409'd if it detected blocking conflicts above.
      // The writer-engine (merge-engine.ts, per-row import_snapshot
      // baseline) has finer precision and may surface field-level conflicts
      // the existing engine missed. Fold its output into the same
      // v2_conflicts_detected envelope so the wizard sees a single,
      // consistent conflict list. Throwing here aborts the transaction so
      // no partial writes leak through.
      const writerEngineConflicts = [
        ...(planResult?.mergeConflicts ?? []),
        ...(revenueResult?.mergeConflicts ?? []),
        ...(costResult?.mergeConflicts ?? []),
      ];
      if (writerEngineConflicts.length > 0) {
        const wizardRows = mergeConflictsToWizardRows(writerEngineConflicts);
        const err = new Error(
          `Three-way merge surfaced ${writerEngineConflicts.length} unresolved field-level conflict(s) on ${wizardRows.length} row(s). ` +
            `Resolve via v2ConflictResolutions and re-submit.`,
        );
        (err as any).status = 409;
        (err as any).code = "v2_conflicts_detected";
        (err as any).conflicts = wizardRows;
        throw err;
      }

      // ── PR2C: Auxiliary captures from the source workbook ──
      // These three writers persist data the section writers above don't
      // touch: 1:N orphan actual rows for Expenditure, the
      // top-of-Project-Plan metadata block, and the top-of-Revenue-Tracking
      // summary block. Each writer is idempotent — re-importing an
      // unchanged workbook produces zero writes here.
      const importMetrics = newImportMetrics(runId, projectId);
      const importStartedAt = Date.now();
      try {
        if (Array.isArray(norm.actualLineRows) && norm.actualLineRows.length > 0) {
          const actualResult = await writeActualLineRows({
            tx, projectId, runId, commitTimestamp,
            actualLineRows: norm.actualLineRows,
          });
          importMetrics.actuals.inserted = actualResult.inserted;
          importMetrics.actuals.orphaned = actualResult.orphaned;
          if (actualResult.orphaned > 0) {
            console.warn(`[SmartImport] ${actualResult.orphaned} actual-line row(s) had no parent costed line and were skipped.`);
          }
        }
        if (norm.projectPlanMetadata) {
          const r = await writeProjectMetadata({
            tx, projectId, runId, commitTimestamp,
            metadata: norm.projectPlanMetadata,
            sourceSheet: (norm.projectPlanMetadata as any)?.sourceSheet ?? null,
          });
          importMetrics.metadata.written = r.written;
        }
        if (norm.costedSummary) {
          const r = await writeRevenueSummary({
            tx, projectId, runId, commitTimestamp,
            costedSummary: norm.costedSummary,
            costedSummarySource: norm.costedSummarySource ?? null,
          });
          importMetrics.summary.written = r.written;
        }
      } catch (auxErr) {
        // Auxiliary writes are non-blocking — the import has already
        // succeeded for the canonical tables. Surface as warnings.
        console.error("[SmartImport] Auxiliary writer failure (non-blocking):", auxErr);
      }

      // Aggregate per-section counters into the structured metrics
      // emission so an operator can grep `[SmartImport.metrics]` in the
      // app log and see exactly what every import did.
      if (planResult) {
        importMetrics.plan.inserted = planResult.counts.inserted;
        importMetrics.plan.updated = planResult.counts.updated;
        importMetrics.plan.unchanged = planResult.counts.unchanged ?? 0;
        importMetrics.plan.conflictsSurfaced = (planResult.mergeConflicts ?? []).length;
      }
      if (revenueResult) {
        importMetrics.revenue.inserted = revenueResult.counts.inserted;
        importMetrics.revenue.updated = revenueResult.counts.updated;
        importMetrics.revenue.unchanged = revenueResult.counts.unchanged ?? 0;
        importMetrics.revenue.conflictsSurfaced = (revenueResult.mergeConflicts ?? []).length;
      }
      if (costResult) {
        importMetrics.expenditure.inserted = costResult.counts.inserted;
        importMetrics.expenditure.updated = costResult.counts.updated;
        importMetrics.expenditure.unchanged = costResult.counts.unchanged ?? 0;
        importMetrics.expenditure.conflictsSurfaced = (costResult.mergeConflicts ?? []).length;
      }
      importMetrics.threeWayMergeEnabled = threeWayMergeEnabled();
      importMetrics.durationMs = Date.now() - importStartedAt;
      emitImportMetrics(importMetrics);

      // ── S09: Write category_revenue_allocations ──
      // Persist extracted J_cat values from the normalization result.
      const catAllocs = norm.categoryAllocations as Array<{
        categoryNumber: string; categoryName: string; categoryKey: string;
        categorySortOrder: number; revenueAllocation: number | null;
        cosTotalCosted: number | null; budgetTotal: number | null;
        allocationSource: string; sourceSheet: string; sourceRow: number;
      }> | undefined;

      // Map from categoryKey → inserted allocation row ID (for S10 FK)
      const catAllocIdByKey = new Map<string, number>();

      if (catAllocs && catAllocs.length > 0) {
        // Soft-close existing active allocations for this project
        await tx.update(categoryRevenueAllocations)
          .set({ effectiveTo: commitTimestamp })
          .where(and(
            eq(categoryRevenueAllocations.projectId, projectId),
            isNull(categoryRevenueAllocations.effectiveTo),
          ));

        // Insert new allocations
        for (const ca of catAllocs) {
          // Use the centralized normalizer so any future allocationSource
          // value (upper-case, mixed-case, legacy shorthand) still lands on
          // the canonical lowercase enum literal that the DB expects.
          const confidence = normalizeAllocationConfidence(ca.allocationSource);

          const [inserted] = await tx.insert(categoryRevenueAllocations).values({
            projectId,
            projectName,
            categoryNumber: ca.categoryNumber,
            categoryName: ca.categoryName,
            categoryKey: ca.categoryKey,
            categorySortOrder: ca.categorySortOrder,
            revenueAllocation: ca.revenueAllocation != null ? String(ca.revenueAllocation) : null,
            allocationConfidence: confidence,
            budgetTotal: ca.budgetTotal != null ? String(ca.budgetTotal) : null,
            budgetCos: ca.cosTotalCosted != null ? String(ca.cosTotalCosted) : null,
            importRunId: runId,
            effectiveFrom: commitTimestamp,
            effectiveTo: null,
            snapshotRunId: runId,
            sourceSheet: ca.sourceSheet,
            sourceRow: ca.sourceRow,
          }).returning();
          catAllocIdByKey.set(ca.categoryKey, inserted.id);
        }
      }

      // ── S10: Populate category_key and category_allocation_id on NCL rows ──
      // Set category_key on all active NCL rows for this project, including UNCHANGED rows.
      if (catAllocIdByKey.size > 0) {
        // Build a lookup from category_name (stripped) → categoryKey + allocationId
        const catNameToKeyId = new Map<string, { key: string; id: number }>();
        for (const ca of catAllocs!) {
          catNameToKeyId.set(ca.categoryName.toLowerCase(), { key: ca.categoryKey, id: catAllocIdByKey.get(ca.categoryKey)! });
          // Also index by full key for rows that already have numbered categories
          catNameToKeyId.set(ca.categoryKey.toLowerCase(), { key: ca.categoryKey, id: catAllocIdByKey.get(ca.categoryKey)! });
        }

        // Fetch ALL active NCL rows for this project (includes UNCHANGED ones).
        // categoryAllocationId is included so the condition below can skip
        // rows that are already fully up-to-date, avoiding unnecessary writes.
        const activeNclRows = await tx.select({
          id: normalizedCostLines.id,
          costCategory: normalizedCostLines.costCategory,
          categoryKey: normalizedCostLines.categoryKey,
          categoryAllocationId: normalizedCostLines.categoryAllocationId,
        })
          .from(normalizedCostLines)
          .where(and(
            eq(normalizedCostLines.projectId, projectId),
            and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)),
          ));

        // Update each row whose categoryKey or categoryAllocationId is wrong.
        // Because category_revenue_allocations are soft-closed and re-inserted
        // on every import, the FK always needs refreshing — even for rows that
        // already have the correct key string.
        for (const row of activeNclRows) {
          const catName = (row.costCategory || "").toLowerCase().trim();
          const match = catNameToKeyId.get(catName);
          if (match && (row.categoryKey !== match.key || row.categoryAllocationId !== match.id)) {
            await tx.update(normalizedCostLines)
              .set({
                categoryKey: match.key,
                categoryAllocationId: match.id,
              })
              .where(and(
                eq(normalizedCostLines.id, row.id),
                isNull(normalizedCostLines.effectiveTo),
              ));
          }
        }
      }

      // ── S11: noRevenueLinked recon ──
      // For cost lines inserted in this run that have no category allocation
      // FK (and no explicit revenueRecognitionAmount), there is no formula
      // linking them to a revenue milestone, so mark noRevenueLinked = true.
      // Only runs when the workbook provided category allocations (catAllocIdByKey
      // non-empty), so imports without a budget pane don't mass-flag every line.
      // Only touches rows from this run (importRunId = runId) to leave
      // manually-set flags on older rows undisturbed.
      if (costResult && costResult.counts.inserted > 0 && catAllocIdByKey.size > 0) {
        try {
          await tx.update(normalizedCostLines)
            .set({ noRevenueLinked: true })
            .where(and(
              eq(normalizedCostLines.projectId, projectId),
              eq(normalizedCostLines.importRunId, runId),
              isNull(normalizedCostLines.effectiveTo),
              isNull(normalizedCostLines.categoryAllocationId),
              isNull(normalizedCostLines.revenueRecognitionAmount),
            ));
        } catch (reconErr: unknown) {
          console.warn("[SmartImport] noRevenueLinked recon failed (non-blocking):", reconErr instanceof Error ? reconErr.message : String(reconErr));
        }
      }

      v2Result = {
        sections: {
          PLAN: planResult,
          REVENUE: revenueResult,
          EXPENDITURE: costResult,
        },
        totalInserted: (planResult?.counts.inserted || 0) + (revenueResult?.counts.inserted || 0) + (costResult?.counts.inserted || 0),
        totalUpdated: (planResult?.counts.updated || 0) + (revenueResult?.counts.updated || 0) + (costResult?.counts.updated || 0),
        totalUnchanged: (planResult?.counts.unchanged || 0) + (revenueResult?.counts.unchanged || 0) + (costResult?.counts.unchanged || 0),
        totalMissing: (planResult?.counts.missing || 0) + (revenueResult?.counts.missing || 0) + (costResult?.counts.missing || 0),
      };

      // Handle execution phases (simple re-insert — no temporal matching)
      if (norm.executionPhases && norm.executionPhases.length > 0) {
        await tx.delete(normalizedExecutionPhases).where(eq(normalizedExecutionPhases.projectId, projectId));
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

      // Update project info from detected metadata (same as v1)
      const detectedInfo = summary.detection?.projectInfo;
      if (detectedInfo && projectId) {
        const VALID_PHASES = ["dlp", "financial close", "planning", "construction", "qa", "handover", "commercial close out", "compliance handover", "hold"];
        const [existingProject] = await tx.select({ pm: projectInfo.pm, pd: projectInfo.pd }).from(projectInfo).where(eq(projectInfo.id, projectId));
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
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await tx.update(projectInfo).set(updates).where(eq(projectInfo.id, projectId));
          await syncProjectSplitTables(projectId, updates, tx);
        }
      }

      // ── S12: Post-commit project_revenue_summary refresh ──
      // Refreshes project_revenue_summary from the normalized costedSummary
      // so the FYE Detail view sees fresh budget/actual revenue and COS
      // figures after each v2 commit. (Previously this helper also wrote
      // program_expense and program_inflows as back-compat derivatives;
      // those writes were removed in the PE/PI retirement.)
      try {
        const matResult = await materializeDerivatives({
          tx, projectId, projectName, runId, commitTimestamp, norm,
        });
        console.log(`[SmartImport] v2 project_revenue_summary refresh: PRS=${matResult.projectRevenueSummaryUpdated}`);
      } catch (matErr: unknown) {
        // PRS refresh failure is non-blocking for the canonical commit.
        console.warn("[SmartImport] project_revenue_summary refresh failed (non-blocking):", (matErr instanceof Error ? matErr.message : String(matErr)));
      }

      // ── S13: Canonical expense_task_links re-linking ──
      // After v2 commit creates new NCL rows (soft-close + insert for CHANGED),
      // update canonical_expense_id on expense_task_links to point to the new IDs.
      if (costResult && (costResult.counts.updated > 0 || costResult.counts.inserted > 0)) {
        try {
          // Build old→new NCL ID map from the commit result.
          // updatedIds = old IDs that were soft-closed, insertedIds = new IDs that replaced them.
          // For CHANGED rows, updatedIds[i] is the old ID and insertedIds[i] is the new ID
          // (both arrays are populated in parallel by writeExpenditureIncremental).
          const oldToNewNcl = new Map<number, number>();
          if (costResult.updatedIds && costResult.insertedIds) {
            for (let i = 0; i < costResult.updatedIds.length; i++) {
              if (i < costResult.insertedIds.length) {
                oldToNewNcl.set(costResult.updatedIds[i], costResult.insertedIds[i]);
              }
            }
          }

          // Also build a set of all current active NCL IDs for orphan detection
          const activeNclIds = new Set<number>();
          const activeNclForLinks = await tx.select({ id: normalizedCostLines.id })
            .from(normalizedCostLines)
            .where(and(eq(normalizedCostLines.projectId, projectId), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))));
          for (const r of activeNclForLinks) activeNclIds.add(r.id);

          // Fetch links for this project that have canonical_expense_id set
          const projectLinks = await tx.select().from(expenseTaskLinks)
            .where(eq(expenseTaskLinks.projectName, projectName));

          for (const link of projectLinks) {
            const canonId = link.canonicalExpenseId;
            if (canonId == null) continue;

            // If the canonical ID was soft-closed (old ID), remap to the new ID
            if (oldToNewNcl.has(canonId)) {
              await tx.update(expenseTaskLinks)
                .set({ canonicalExpenseId: oldToNewNcl.get(canonId)! })
                .where(eq(expenseTaskLinks.id, link.id));
            }
            // If the canonical ID no longer points to an active NCL row
            // (and wasn't remapped), clear it so it can be re-resolved
            else if (!activeNclIds.has(canonId)) {
              await tx.update(expenseTaskLinks)
                .set({ canonicalExpenseId: null })
                .where(eq(expenseTaskLinks.id, link.id));
            }
          }
        } catch (linkErr: unknown) {
          console.warn("[SmartImport] Canonical link re-pointing failed (non-blocking):", (linkErr instanceof Error ? linkErr.message : String(linkErr)));
        }
      }

      // Finalize: mark as committed
      const totalAttempted = (norm.planTasks?.length || 0) + (norm.revenueLines?.length || 0) + (norm.costLines?.length || 0) + (norm.executionPhases?.length || 0);
      const totalSucceeded = (counts.planTasks || 0) + (counts.revenueLines || 0) + (counts.costLines || 0) + (counts.executionPhases || 0);
      const totalFailed = totalAttempted - totalSucceeded;
      const detectedSections: string[] = [];
      if (norm.planTasks?.length > 0) detectedSections.push("PLAN");
      if (norm.revenueLines?.length > 0) detectedSections.push("REVENUE");
      if (norm.costLines?.length > 0) detectedSections.push("EXPENDITURE");

      await tx.update(smartImportRuns).set({
        status: "committed",
        committedAt: new Date(),
        committedBy: userId,
        recordsAttempted: totalAttempted,
        recordsSucceeded: totalSucceeded,
        recordsFailed: totalFailed,
        importType: detectedSections.join(","),
      }).where(eq(smartImportRuns.id, runId));
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

    // Step 4.6: Log v2 3-way conflict resolution decisions
    if (v2ConflictResolutions && Object.keys(v2ConflictResolutions).length > 0) {
      try {
        for (const [key, decision] of Object.entries(v2ConflictResolutions)) {
          const sepIdx = key.lastIndexOf("::");
          if (sepIdx < 0) continue;
          const rowKey = key.substring(0, sepIdx);
          const fieldName = key.substring(sepIdx + 2);

          await db.insert(conflictResolutionLog).values({
            importRunId: runId,
            entityType: "v2_3way_merge",
            entityId: rowKey,
            fieldName,
            manualValue: decision === "keep_app" ? "preserved" : null,
            importValue: decision === "accept_file" ? "applied" : null,
            decision: decision === "keep_app" ? "KEEP_MANUAL" : "OVERWRITE_WITH_IMPORT",
            decidedByUserId: userId,
            decidedByName: (req as any).user?.name || null,
          });
        }
      } catch (v2ResLogErr: any) {
        console.warn("[smart-import] v2 conflict resolution logging failed (non-blocking):", v2ResLogErr.message);
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
        status: totalWritten > 0 ? (totalSkipped > 0 ? "partial" : "success") : "failed",
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
      // V2 incremental commit details (null when v1 fallback was used)
      // v2Result is mutated inside the transaction callback; capture to
      // a fresh const so TypeScript can narrow the type correctly.
      v2: (() => {
        const r = v2Result as IncrementalCommitResult | null;
        if (!r) return undefined;
        // Per-row warnings from the section commit-executors. Today only the
        // PLAN executor produces them (per-row SAVEPOINT + collision capture)
        // — that's where the historic 500s came from. Surfacing the array
        // lets the Smart Import UI render a "rows that didn't import"
        // panel instead of failing the whole commit silently.
        const rowWarnings = (["PLAN", "REVENUE", "EXPENDITURE"] as const)
          .flatMap(k => (r.sections[k]?.warnings ?? []).map(w => ({ section: k, ...w })));
        return {
          totalInserted: r.totalInserted,
          totalUpdated: r.totalUpdated,
          totalUnchanged: r.totalUnchanged,
          totalMissing: r.totalMissing,
          rowWarnings: rowWarnings.length > 0 ? rowWarnings : undefined,
        };
      })(),
      preservedOverrides: skippedOverrideFields.length > 0 ? skippedOverrideFields : undefined,
      preservedManualEdits: preservedManualEditsCount > 0 ? preservedManualEditsCount : undefined,
      overwriteWarnings: overwriteWarnings.length > 0 ? overwriteWarnings : undefined,
    });

    // Refresh materialized dashboard metrics after import commit (both v1 and v2)
    if (projectId) refreshProjectMetricsAsync(projectId);
  } catch (err: unknown) {
    const pgCause = (err as any)?.cause;
    console.error("[smart-import] POST commit error:", err);
    if (pgCause) {
      console.error("[smart-import] PostgreSQL cause:", {
        message: pgCause?.message,
        detail: pgCause?.detail,
        code: pgCause?.code,
        constraint: pgCause?.constraint,
        table: pgCause?.table,
        column: pgCause?.column,
        schema: pgCause?.schema,
      });
    }

    // Log failed import attempt
    try {
      const userId = (req as any).user?.id || null;
      const runId = parseIntParam(req.params.runId);
      if (!isNaN(runId)) {
        const causeMsg = pgCause ? ` | PG: ${pgCause.message || ''} [${pgCause.code || ''}] constraint=${pgCause.constraint || ''} detail=${pgCause.detail || ''}` : '';
        const [failedRun] = await db.select({ fileName: smartImportRuns.sourceFileName, projectName: smartImportRuns.projectName })
          .from(smartImportRuns).where(eq(smartImportRuns.id, runId)).limit(1);
        await db.insert(importLogs).values({
          importRunId: runId,
          fileName: failedRun?.fileName || "unknown",
          importedByUserId: userId,
          importedByName: (req as any).user?.name || null,
          projectName: failedRun?.projectName || null,
          status: "failed",
          errorMessage: ((err instanceof Error ? err.message : String(err)) + causeMsg).substring(0, 2000),
        });
      }
    } catch (_) { /* non-blocking */ }

    // 409 is a known business error (e.g. run already committed, project_id
    // missing) where the thrown message is UI-safe; preserve it. 5xx goes to
    // the global error handler which sanitises and attaches a traceId. PG
    // error details were logged server-side above and are never returned.
    if ((err as any)?.status === 409) {
      // Engine consolidation Phase 1 — writer-engine surfaced field-level
      // conflicts. Emit the same v2_conflicts_detected envelope as the
      // pre-commit existing engine so the wizard parser is unchanged.
      if ((err as any)?.code === "v2_conflicts_detected") {
        /* eslint-disable no-restricted-syntax -- intentional: 409 business error with structured conflict payload for the wizard */
        return res.status(409).json({
          error: "v2_conflicts_detected",
          message: (err instanceof Error ? err.message : "Three-way merge conflicts detected."),
          conflicts: (err as any).conflicts ?? [],
          hint: "Resolve conflicts via v2ConflictResolutions: { 'rowKey::fieldName': 'keep_app' | 'accept_file' }",
        });
        /* eslint-enable no-restricted-syntax */
      }
      // eslint-disable-next-line no-restricted-syntax -- intentional: 409 business error message is user-authored
      return res.status(409).json({ error: "COMMIT_CONFLICT", message: (err instanceof Error ? err.message : "Commit conflict") });
    }
    throw err;
  }
});

// POST /api/smart-import/:runId/rollback
router.post("/api/smart-import/:runId/rollback", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status !== "committed") {
      return res.status(400).json({ error: "Only committed imports can be rolled back" });
    }

    await db.transaction(async (tx: any) => {
      await tx.delete(invoicePatternMatches).where(eq(invoicePatternMatches.importRunId, runId));

      await softCloseByImportRunId(tx, "normalized_revenue_lines", runId);
      await softCloseByImportRunId(tx, "normalized_cost_lines", runId);
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
        .set({ status: "rolled_back" })
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

    res.json({ success: true, runId, status: "rolled_back" });
  } catch (err: unknown) {
    console.error("[smart-import] POST rollback error:", err);
    throw err;
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
  } catch (err: unknown) {
    console.error("[counterparties] POST match error:", err);
    throw err;
  }
});

// GET /api/smart-import/normalized/:projectName/plan
router.get("/api/smart-import/normalized/:projectName/plan", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "committed")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db.select().from(workItems)
      .where(and(
        eq(workItems.importRunId, latestRun.id),
        eq(workItems.workstream, "PM"),
        eq(workItems.source, "SMART_IMPORT"),
      ));

    res.json(records.map((wi: any) => ({
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
  } catch (err: unknown) {
    console.error("[smart-import] GET normalized plan error:", err);
    throw err;
  }
});

// GET /api/smart-import/normalized/:projectName/revenue
router.get("/api/smart-import/normalized/:projectName/revenue", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "committed")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedRevenueLines)
      .where(and(eq(normalizedRevenueLines.importRunId, latestRun.id), and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))));

    res.json(records);
  } catch (err: unknown) {
    console.error("[smart-import] GET normalized revenue error:", err);
    throw err;
  }
});

// GET /api/smart-import/normalized/:projectName/expenditure
router.get("/api/smart-import/normalized/:projectName/expenditure", requireAuth, async (req: Request, res: Response) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName as string);
    const [latestRun] = await db
      .select()
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectName, projectName), eq(smartImportRuns.status, "committed")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    if (!latestRun) return res.json([]);

    const records = await db
      .select()
      .from(normalizedCostLines)
      .where(and(eq(normalizedCostLines.importRunId, latestRun.id), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))));

    res.json(records);
  } catch (err: unknown) {
    console.error("[smart-import] GET normalized expenditure error:", err);
    throw err;
  }
});

// POST /api/smart-import/bulk-commit
router.post("/api/smart-import/bulk-commit", requireAuth, requirePermission("smart_import", "approve"), async (req: Request, res: Response) => {
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
          eq(smartImportRuns.status, "preview")
        ));
    } else {
      runs = await db.select().from(smartImportRuns)
        .where(eq(smartImportRuns.status, "preview"));
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

        const commitRes = await fetch(`http://0.0.0.0:${process.env.PORT || 5000}/api/smart-import/${run.id}/commit`, {
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
            error: err.error || (err instanceof Error ? err.message : String(err)) || "Commit failed",
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
  } catch (err: unknown) {
    console.error("[smart-import] POST bulk-commit error:", err);
    throw err;
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
      filtered = filtered.filter((r: any) => {
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
      filtered = filtered.filter((r: any) => r.status === status);
    }

    const enriched = await Promise.all(filtered.map(async (run: any) => {
      const issues = await db.select().from(importIssues)
        .where(eq(importIssues.importRunId, run.id));

      const summary = run.summaryJson as any;
      const norm = summary?.normalization || {};
      const sections: string[] = [];
      if (norm.planTasks?.length > 0) sections.push("PLAN");
      if (norm.revenueLines?.length > 0) sections.push("REVENUE");
      if (norm.costLines?.length > 0) sections.push("EXPENDITURE");

      const attempted = (norm.planTasks?.length || 0) + (norm.revenueLines?.length || 0) + (norm.costLines?.length || 0);
      const failedIssues = issues.filter((i: any) => i.severity === "BLOCKER" && !i.resolved);

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
        recordsSucceeded: run.recordsSucceeded ?? (run.status === "committed" ? attempted - failedIssues.length : 0),
        recordsFailed: run.recordsFailed ?? failedIssues.length,
        importType: run.importType ?? sections.join(","),
        sections,
        totalIssues: issues.length,
        unresolvedBlockers: failedIssues.length,
        unresolvedWarnings: issues.filter((i: any) => i.severity !== "BLOCKER" && !i.resolved).length,
        resolvedIssues: issues.filter((i: any) => i.resolved).length,
      };
    }));

    res.json(enriched);
  } catch (err: unknown) {
    console.error("[import-control-tower] GET history error:", err);
    throw err;
  }
});

router.get("/api/import-control-tower/run/:runId/errors", requireAuth, requirePermission("admin", "view"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    const issues = await db.select().from(importIssues)
      .where(eq(importIssues.importRunId, runId));

    const enrichedIssues = issues.map((issue: any) => ({
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
  } catch (err: unknown) {
    console.error("[import-control-tower] GET run errors:", err);
    throw err;
  }
});

router.post("/api/import-control-tower/retry/:runId", requireAuth, requirePermission("admin", "edit"), async (req: Request, res: Response) => {
  try {
    const runId = parseIntParam(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ error: "Invalid runId" });

    const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
    if (!run) return res.status(404).json({ error: "Import run not found" });

    if (run.status !== "failed" && run.status !== "rolled_back" && run.status !== "preview") {
      return res.status(400).json({ error: `Cannot retry import with status "${run.status}". Only failed, rolled_back, or preview runs can be retried.` });
    }

    await db.update(smartImportRuns)
      .set({ status: "preview" })
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

    res.json({ success: true, runId, newStatus: "preview" });
  } catch (err: unknown) {
    console.error("[import-control-tower] POST retry error:", err);
    throw err;
  }
});

// ── Smart-import audit log endpoint (admin-only, paginated) ────────
router.get("/api/smart-import/audit-log", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 25));
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(auditEvents)
        .where(eq(auditEvents.entityType, "smart_import")),
      db.select()
        .from(auditEvents)
        .where(eq(auditEvents.entityType, "smart_import"))
        .orderBy(desc(auditEvents.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    res.json({
      success: true,
      data: rows,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (err: unknown) {
    console.error("[smart-import] GET audit-log error:", err);
    throw err;
  }
});

export function registerSmartImportRoutes(app: Express) {
  app.use(router);
}
