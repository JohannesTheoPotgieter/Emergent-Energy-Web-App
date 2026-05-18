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
import { and, eq, inArray } from "drizzle-orm";
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
import { commitSmartImportRunAsSystem } from "./scheduler-commit";
import logger from "../lib/logger";

export interface ScheduledImportV2Result {
  triggerType: "schedule" | "manual";
  triggeredBy: string;
  filesDiscovered: number;
  filesCommitted: number;
  filesParked: number;
  filesSkipped: number;
  filesFailed: number;
  runIds: number[];
  committedRunIds: number[];
  errors: Array<{ fileName: string; error: string }>;
  durationMs: number;
}

interface FileOutcome {
  status: "committed" | "parked" | "skipped" | "failed";
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
    logger.warn(`[ScheduledImportV2] Planner failed for ${fileName}:`, err instanceof Error ? err.message : err);
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

  // Insert the run as `preview` (matching the upload route's contract) when
  // we have a project and the policy says commit; otherwise as
  // `awaiting_review` so the UI surfaces it for human attention.
  const initialStatus = autoMappedProjectId && policyDecision.decision === "commit"
    ? "preview"
    : "awaiting_review";

  const [run] = await db
    .insert(smartImportRuns)
    .values({
      projectId: autoMappedProjectId,
      projectName: resolvedProjectName,
      uploadedBy: null,
      sourceFileName: fileName,
      sourceFileHash: fileHash,
      status: initialStatus,
      summaryJson,
    })
    .returning();

  // Auto-commit path: when we have a project AND the policy decided to
  // commit, hand off to the scheduler commit service. Anything other than a
  // clean commit leaves the run for human review.
  if (autoMappedProjectId && policyDecision.decision === "commit") {
    try {
      const commitResult = await commitSmartImportRunAsSystem({
        runId: run.id,
        v2ConflictResolutions: policyDecision.resolutions,
      });
      if (commitResult.status === "committed") {
        return { status: "committed", runId: run.id };
      }
      // H2: tally the outcome based on what the commit service actually did.
      // Critically, when `commitResult.status === "skipped_already_committed"`
      // a concurrent UI commit won the race — the run is already in
      // `committed` state and we MUST NOT overwrite it. Treat as skipped.
      if (commitResult.status === "skipped_already_committed") {
        return { status: "skipped", runId: run.id };
      }
      // For `skipped_recency_*` and `blocked_*` outcomes the run was never
      // claimed (early return before the transaction) OR the transaction
      // rolled back. The DB status is whatever `initialStatus` set it to
      // (`preview`). Flip to `awaiting_review` so the UI surfaces it as
      // needing human attention. Done with a guarded UPDATE so a racing
      // UI commit (which legitimately flipped to `committed`) isn't
      // clobbered.
      await db.update(smartImportRuns)
        .set({ status: "awaiting_review" })
        .where(and(
          eq(smartImportRuns.id, run.id),
          inArray(smartImportRuns.status, ["preview", "awaiting_review"]),
        ));
      logger.info(`[ScheduledImportV2] Commit deferred for run ${run.id}: ${commitResult.status}`);
      return { status: "parked", runId: run.id };
    } catch (commitErr) {
      // Transaction failed — mark as awaiting_review (guarded so a racing
      // UI commit isn't clobbered) and report the file as failed.
      logger.error(`[ScheduledImportV2] Auto-commit failed for run ${run.id}:`, commitErr instanceof Error ? commitErr.message : commitErr);
      try {
        await db.update(smartImportRuns)
          .set({ status: "awaiting_review" })
          .where(and(
            eq(smartImportRuns.id, run.id),
            inArray(smartImportRuns.status, ["preview", "awaiting_review"]),
          ));
      } catch { /* non-blocking */ }
      return {
        status: "failed",
        runId: run.id,
        error: `Auto-commit failed: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
      };
    }
  }

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
    logger.warn("[ScheduledImportV2] detectChanges housekeeping failed (non-blocking):", err instanceof Error ? err.message : err);
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
    filesCommitted: 0,
    filesParked: 0,
    filesSkipped: 0,
    filesFailed: 0,
    runIds: [],
    committedRunIds: [],
    errors: [],
    durationMs: 0,
  };

  for (const child of folderChildren) {
    try {
      const outcome = await processFileV2(
        { id: child.id, name: child.name, driveId: settings.driveId },
        opts.triggeredBy,
      );
      if (outcome.status === "committed") {
        result.filesCommitted++;
        if (outcome.runId) {
          result.runIds.push(outcome.runId);
          result.committedRunIds.push(outcome.runId);
        }
      } else if (outcome.status === "parked") {
        result.filesParked++;
        if (outcome.runId) result.runIds.push(outcome.runId);
      } else if (outcome.status === "skipped") {
        result.filesSkipped++;
      } else {
        result.filesFailed++;
        if (outcome.error) result.errors.push({ fileName: child.name, error: outcome.error });
        if (outcome.runId) result.runIds.push(outcome.runId);
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
