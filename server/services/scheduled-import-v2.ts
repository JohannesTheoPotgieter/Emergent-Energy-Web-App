/**
 * Scheduled Import v2 — auto-discovery + auto-preview orchestrator.
 *
 * Replaces the legacy `runFullImport()` (importPipeline.ts) for the 30-min
 * SharePoint scheduler when `AUTO_IMPORT_V2_ENABLED=true`. v1 only writes
 * metadata snapshots; v2 runs files through the canonical Smart Import v2
 * pipeline so they appear as `smart_import_runs` rows in the UI for the
 * source-of-truth banner.
 *
 * **Current scope (Phase 6, PR 1):**
 * - Discover Excel files in the configured SharePoint folder.
 * - Download each file, run `runSmartImportPreview()` against it.
 * - Resolve project matches by filename.
 * - Create a `smart_import_runs` row in `awaiting_review` state with the
 *   full preview, planner output, and project-match diagnostics so the
 *   UI's existing approval flow can finish the commit.
 * - Update `sp_settings.lastRunAt` on completion.
 *
 * **Deferred to follow-up PR:**
 * - Auto-commit when the planner reports no conflicts. Needs the
 *   `smart-import-routes.ts:/commit` handler (1,199 LOC) to be refactored
 *   into a reusable `commitSmartImportRun()` service first — that touches
 *   finance-write paths and warrants its own focused review.
 * - The auto-resolution policy (see `scheduler-conflict-policy.ts`) is
 *   ready to plug in once the commit service exists.
 */

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { smartImportRuns } from "@shared/schema";
import { detectChanges, downloadFileContent, listFolderChildren } from "../sharepoint";
import { runSmartImportPreview, type SmartImportPreview } from "../lib/import";
import { runImportPlanner } from "../lib/import/planner";
import {
  checkRerunProtection,
  extractProjectNameFromFilename,
  findProjectMatches,
  type ProjectMatch,
} from "../lib/import/project-match";
import { resolveSchedulerConflictPolicy } from "../imports/scheduler-conflict-policy";

export interface ScheduledImportV2Result {
  triggerType: "schedule" | "manual";
  triggeredBy: string;
  filesDiscovered: number;
  filesParked: number;
  filesSkipped: number;
  filesFailed: number;
  runIds: number[];
  errors: Array<{ fileName: string; error: string }>;
  durationMs: number;
}

interface FileOutcome {
  status: "parked" | "skipped" | "failed";
  runId?: number;
  error?: string;
}

function computeHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Process a single SharePoint file: download → preview → match project →
 * insert smart_import_runs row in `awaiting_review` state with full diagnostics.
 *
 * Returns the outcome so the caller can tally a summary.
 */
async function processFileV2(file: {
  id: string;
  name: string;
  driveId: string;
}, triggeredBy: string): Promise<FileOutcome> {
  let buffer: Buffer;
  try {
    buffer = await downloadFileContent(file.driveId, file.id);
  } catch (err) {
    return {
      status: "failed",
      error: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const fileHash = computeHash(buffer);
  const fileName = file.name;

  // Skip exact re-runs (same hash already imported AND committed).
  const rerun = await checkRerunProtection(fileHash);
  if (rerun.isDuplicate && rerun.existingRun?.status === "committed") {
    return { status: "skipped" };
  }

  // Run v2 preview.
  let preview: SmartImportPreview;
  try {
    preview = await runSmartImportPreview(buffer, fileName);
  } catch (err) {
    return {
      status: "failed",
      error: `Preview failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Resolve project by filename.
  const extractedName = extractProjectNameFromFilename(fileName);
  const projectMatches: ProjectMatch[] = await findProjectMatches(extractedName);
  const bestMatch = projectMatches[0];
  const autoMappedProjectId = bestMatch && bestMatch.confidence >= 0.85 ? bestMatch.projectId : null;
  const resolvedProjectName = autoMappedProjectId && bestMatch ? bestMatch.projectName : extractedName;

  // Run planner (only meaningful if we have a project id; otherwise everything is NEW).
  let plannerResult: Awaited<ReturnType<typeof runImportPlanner>> | null = null;
  try {
    plannerResult = await runImportPlanner(autoMappedProjectId, preview.normalization);
  } catch (err) {
    // Planner failures shouldn't lose the file — we still want to park it.
    console.warn(`[ScheduledImportV2] Planner failed for ${fileName}:`, err instanceof Error ? err.message : err);
  }

  // Apply scheduler conflict policy to decide what the commit step would do.
  // For Phase 6 PR 1 the policy decision is informational — the row is still
  // parked as `awaiting_review`. The follow-up PR will use the policy to
  // gate auto-commit.
  const policyDecision = plannerResult
    ? resolveSchedulerConflictPolicy(plannerResult)
    : { decision: "park" as const, reason: "no_planner_result", resolutions: {} };

  const summaryJson = {
    ...(preview as unknown as Record<string, unknown>),
    schedulerV2: {
      triggeredBy,
      triggerType: "schedule",
      extractedProjectName: extractedName,
      autoMappedProjectId,
      autoMappedProjectName: autoMappedProjectId && bestMatch ? bestMatch.projectName : null,
      projectMatchCandidates: projectMatches,
      plannerImportMode: plannerResult?.importMode ?? null,
      plannerHasBlockingConflicts: plannerResult?.conflicts?.hasBlockingConflicts ?? false,
      policyDecision: policyDecision.decision,
      policyReason: policyDecision.reason,
      autoResolvedConflictCount: Object.keys(policyDecision.resolutions).length,
    },
  };

  const [run] = await db
    .insert(smartImportRuns)
    .values({
      projectId: autoMappedProjectId,
      projectName: resolvedProjectName,
      uploadedBy: null,
      sourceFileName: fileName,
      sourceFileHash: fileHash,
      // Phase 6 PR 1: always park. Auto-commit is the follow-up PR.
      status: "awaiting_review",
      summaryJson,
    })
    .returning();

  return { status: "parked", runId: run.id };
}

/**
 * Run the v2 scheduled-import flow against the configured SharePoint folder.
 * Discovers Excel files, parses each through Smart Import v2, and parks them
 * as `awaiting_review` runs for one-click commit via the existing UI.
 */
export async function runScheduledImportV2(opts: {
  triggerType: "schedule" | "manual";
  triggeredBy: string;
}): Promise<ScheduledImportV2Result> {
  const startedAt = Date.now();
  const settings = await storage.getSpSettings();
  if (!settings) {
    throw new Error("SharePoint settings not configured");
  }

  // Refresh the sp_files / change_ledger book-keeping so v2 stays consistent
  // with v1's diff detector. v1's runId-scoped ledger is unused here.
  try {
    await detectChanges(
      settings.siteId,
      settings.driveId,
      settings.folderItemId || undefined,
      settings.folderPath || undefined,
      // omit runId — we're not using the change ledger for v2 dispatch
    );
  } catch (err) {
    console.warn("[ScheduledImportV2] detectChanges housekeeping failed (non-blocking):", err instanceof Error ? err.message : err);
  }

  // List current files in the configured folder.
  let folderChildren: Array<{ id: string; name: string }>;
  try {
    folderChildren = await listFolderChildren(
      settings.driveId,
      settings.folderItemId || undefined,
      settings.folderPath || undefined,
    );
  } catch (err) {
    throw new Error(`SharePoint folder listing failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result: ScheduledImportV2Result = {
    triggerType: opts.triggerType,
    triggeredBy: opts.triggeredBy,
    filesDiscovered: folderChildren.length,
    filesParked: 0,
    filesSkipped: 0,
    filesFailed: 0,
    runIds: [],
    errors: [],
    durationMs: 0,
  };

  for (const child of folderChildren) {
    try {
      const outcome = await processFileV2(
        { id: child.id, name: child.name, driveId: settings.driveId },
        opts.triggeredBy,
      );
      if (outcome.status === "parked") {
        result.filesParked++;
        if (outcome.runId) result.runIds.push(outcome.runId);
      } else if (outcome.status === "skipped") {
        result.filesSkipped++;
      } else {
        result.filesFailed++;
        if (outcome.error) result.errors.push({ fileName: child.name, error: outcome.error });
      }
    } catch (err) {
      result.filesFailed++;
      result.errors.push({
        fileName: child.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await storage.upsertSpSettings({
    ...settings,
    lastRunAt: new Date(),
  });

  result.durationMs = Date.now() - startedAt;
  return result;
}
