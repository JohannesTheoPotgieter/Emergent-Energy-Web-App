/**
 * Scheduled Import v2 — auto-discovery + auto-preview orchestrator.
 *
 * Replaces the legacy `runFullImport()` (importPipeline.ts) for the 30-min
 * SharePoint scheduler when `AUTO_IMPORT_V2_ENABLED=true`. v1 only writes
 * metadata snapshots; v2 runs files through the canonical Smart Import v2
 * pipeline so they appear as `smart_import_runs` rows in the UI for the
 * source-of-truth banner.
 *
 * **Behaviour:**
 * - Discover Excel files in the configured SharePoint folder.
 * - Download each file and run `runSmartImportPreview()` against it, reusing
 *   any learned column mappings for the file's template profile so a tracker
 *   whose columns were corrected once is not re-questioned on re-import.
 * - Resolve the project by filename: a sticky project binding wins; otherwise
 *   fall back to name similarity at the auto-match threshold.
 * - Create a `smart_import_runs` row, then decide commit vs. park: when a
 *   project auto-matched AND the conflict policy (`scheduler-conflict-policy.ts`)
 *   reports the run is clean (no blocking conflicts, no resurrections), hand
 *   off to `commitSmartImportRunAsSystem()` (scheduler-commit.ts) to
 *   auto-commit. Anything else is parked as `awaiting_review` for a human.
 * - Update `sp_settings.lastRunAt` (and alert state) on completion.
 *
 * Note: auto-commit IS wired (it is not deferred). The finance-write commit
 * lives in the dedicated `scheduler-commit.ts` service rather than a refactor
 * of the 1,199-line HTTP `/commit` handler.
 */

import crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { smartImportRuns } from "@shared/schema";
import { detectChanges, downloadFileContent, listFolderChildren } from "../sharepoint";
import { isConnectorMocked } from "../lib/connector-mode";
import { ApiError } from "../lib/api-error";
import { runSmartImportPreview, type SmartImportPreview } from "../lib/import";
import { runImportPlanner } from "../lib/import/planner";
import {
  buildImportFailureEnvelope,
  persistFailedImportRun,
  type ImportFailureEnvelope,
} from "../lib/import/failure-envelope";
import {
  checkRerunProtection,
  extractProjectNameFromFilename,
  findProjectMatches,
  type ProjectMatch,
} from "../lib/import/project-match";
import {
  planFolderIngest,
  type QuarantinedFile,
} from "../lib/import/ingest-hygiene";
import {
  decideSchedulerAutoCommit,
  computeSoftClosePct,
  detectErrorOnRev,
  detectMissingAllocationOnNewLines,
  collectCommitLockDates,
  detectNetDeltaExceeded,
  buildProjectMetricSwings,
  NET_DELTA_PARK_THRESHOLD_PCT,
  type AutoCommitGateSignals,
} from "../lib/import/auto-commit-gate";
import { getReconciliationDetail } from "./reconciliation-service";
import { notifyUsers } from "./notification-service";
import { UsersRepository } from "../repositories/users-repository";
import { enforceCosPeriodLock } from "../lib/finance/period-lock";
import { resolveSchedulerConflictPolicy } from "../imports/scheduler-conflict-policy";
import { commitSmartImportRunAsSystem } from "./scheduler-commit";
import { IMPORT_FILE_ALWAYS_WINS } from "../imports/import-conflict-policy";
import {
  getLearnedMappingsForFile,
  findActiveBindingForFile,
  recordBindingUsage,
  getProjectNameById,
} from "../repositories/import-config-repository";
import { maybeSendImportAlert } from "./import-alert-service";

export interface ScheduledImportV2Result {
  triggerType: "schedule" | "manual";
  triggeredBy: string;
  /**
   * Batch id stamped on every file's summaryJson.schedulerV2 during this
   * tick. Operators land on the Import Control Tower filtered by this id
   * to see the entire folder-import completion screen.
   */
  batchRunId: string | null;
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

// Auto-match bar for unattended folder pickups. File-always-wins lowers it to
// match the interactive "attach to closest >=0.75" policy; otherwise keep the
// conservative >=0.85 auto-map. Shared by processFileV2 and the dedupe
// resolver so the two never drift.
const AUTO_MATCH_THRESHOLD = IMPORT_FILE_ALWAYS_WINS ? 0.75 : 0.85;

const usersRepository = new UsersRepository();

/**
 * Finance / management roles that own import review. They get the in-app
 * notification when a scheduled run parks on a net-delta swing (the Teams alert
 * fires separately via the orchestrator's `maybeSendImportAlert`). Excludes PMs/
 * CMs, who can view but not commit imports (smart_import:approve = COO/CEO).
 */
const NET_DELTA_NOTIFY_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "CFO",
  "PROGRAM_FINANCE_MANAGER",
];

/** In-app notification (throttled) to the finance reviewers that a run parked on
 *  a net-delta swing, with the reason + a deep link to the run via the
 *  smart_import related entity. Non-blocking. */
async function notifyNetDeltaPark(
  runId: number,
  projectName: string,
  projectId: number,
  reason: string,
): Promise<void> {
  try {
    const recipients = await usersRepository.listByRoles(NET_DELTA_NOTIFY_ROLES);
    if (recipients.length === 0) return;
    await notifyUsers(
      recipients.map((r) => r.id),
      {
        eventType: "import_net_delta_park",
        title: `Import parked for review — ${projectName}`,
        body: `Auto-import held: ${reason}. Open the import to check the swing and commit.`,
        projectName,
        projectId,
        relatedEntityType: "smart_import",
        relatedEntityId: runId,
      },
    );
  } catch (notifyErr) {
    console.warn(
      `[ScheduledImportV2] net-delta in-app notification failed for run ${runId}:`,
      notifyErr instanceof Error ? notifyErr.message : notifyErr,
    );
  }
}

/**
 * NET-DELTA GUARD (owner-approved). Before an unattended commit, compare the
 * project's CURRENT REV/COS to what THIS run WOULD produce. The "would" comes
 * from the dry-run preview — the REAL commit path applied inside a transaction
 * then rolled back — so there is no parallel formula; both sides are summed from
 * the canonical recon lines (§ 3.3). If either metric swings beyond the
 * threshold the run is parked (status `awaiting_review`, the net-delta reason
 * stored on the run, finance reviewers notified in-app; the Teams alert fires via
 * the outcome path). Reads the canonical finance path; changes NO reported number
 * — only commit-vs-park routing. Returns true when it parked.
 *
 * Fail-safe: if the check itself errors, the run is parked rather than risk an
 * unattended commit of a possibly-large swing.
 */
async function maybeParkOnNetDelta(opts: {
  runId: number;
  projectId: number;
  projectName: string;
  v2ConflictResolutions: Record<string, "keep_app" | "accept_file">;
  gateSignals: AutoCommitGateSignals;
  summaryJson: Record<string, unknown>;
}): Promise<boolean> {
  const { runId, projectId, projectName, v2ConflictResolutions, gateSignals, summaryJson } = opts;
  try {
    // Current totals (canonical read) + the totals this run WOULD produce
    // (dry-run preview: real commit applied in a tx, then rolled back).
    const currentRecon = await getReconciliationDetail(db, projectId);
    const dry = await commitSmartImportRunAsSystem({ runId, v2ConflictResolutions, dryRun: true });
    if (dry.status !== "dry_run_preview") return false;
    const nextRecon = dry.recon;
    if (!nextRecon) return false;

    const swings = buildProjectMetricSwings(projectName, currentRecon.lines, nextRecon.lines);
    const delta = detectNetDeltaExceeded(swings, NET_DELTA_PARK_THRESHOLD_PCT);
    if (!delta.exceeded) return false;

    const parkDecision = decideSchedulerAutoCommit({
      ...gateSignals,
      deltaExceeded: true,
      deltaExceededDetail: delta.detail,
    });
    const sv2 = (summaryJson.schedulerV2 ?? {}) as Record<string, unknown>;
    await db
      .update(smartImportRuns)
      .set({
        status: "awaiting_review",
        summaryJson: {
          ...summaryJson,
          schedulerV2: { ...sv2, autoCommitGate: { decision: "park", reason: parkDecision.reason } },
        },
      })
      .where(and(eq(smartImportRuns.id, runId), inArray(smartImportRuns.status, ["preview", "awaiting_review"])));
    console.warn(`[ScheduledImportV2] net-delta park for run ${runId}: ${parkDecision.reason}`);
    await notifyNetDeltaPark(runId, projectName, projectId, parkDecision.reason);
    return true;
  } catch (deltaErr) {
    console.warn(
      `[ScheduledImportV2] net-delta check failed for run ${runId} (parking to be safe):`,
      deltaErr instanceof Error ? deltaErr.message : deltaErr,
    );
    try {
      await db
        .update(smartImportRuns)
        .set({ status: "awaiting_review" })
        .where(and(eq(smartImportRuns.id, runId), inArray(smartImportRuns.status, ["preview", "awaiting_review"])));
    } catch {
      /* non-blocking */
    }
    return true;
  }
}

/**
 * Build an ISO-keyed batch identifier for one scheduler tick.
 * Every file processed in this tick stamps it on summaryJson.schedulerV2.batchRunId
 * so the Import Control Tower can group them under a single "Folder Import
 * Batch" view (filtered + breadcrumbed) — see /admin/import-control-tower
 * with ?batchRunId=<id>.
 */
function makeBatchRunId(): string {
  return `batch_${new Date().toISOString()}`;
}

/**
 * Process a single SharePoint file: download → preview → match project →
 * insert smart_import_runs row in `awaiting_review` state with full diagnostics.
 *
 * Returns the outcome so the caller can tally a summary.
 */
async function processFileV2(
  file: {
    id: string;
    name: string;
    driveId: string;
  },
  triggeredBy: string,
  batchRunId: string,
): Promise<FileOutcome> {
  const fileName = file.name;
  const extraSummary = {
    schedulerV2: { triggerType: "schedule", batchRunId },
  };
  let buffer: Buffer;
  try {
    buffer = await downloadFileContent(file.driveId, file.id);
  } catch (err) {
    const envelope = buildImportFailureEnvelope("download", fileName, err);
    const runId = await persistFailedImportRun({
      fileName,
      fileHash: null,
      envelope,
      extraSummary,
      projectName: "Unmatched — scheduler failure",
    });
    return {
      status: "failed",
      runId: runId ?? undefined,
      error: envelope.message,
    };
  }

  const fileHash = computeHash(buffer);

  // Skip exact re-runs (same hash already imported AND committed).
  const rerun = await checkRerunProtection(fileHash);
  if (rerun.isDuplicate && rerun.existingRun?.status === "committed") {
    return { status: "skipped" };
  }

  // Run v2 preview, reusing any learned column mappings for this tracker so
  // corrected columns aren't re-questioned on the next scheduled run.
  let preview: SmartImportPreview;
  try {
    const learnedMappings = await getLearnedMappingsForFile(fileName);
    preview = await runSmartImportPreview(buffer, fileName, learnedMappings);
  } catch (err) {
    const envelope = buildImportFailureEnvelope("preview", fileName, err);
    const runId = await persistFailedImportRun({
      fileName,
      fileHash,
      envelope,
      extraSummary,
      projectName: "Unmatched — scheduler failure",
    });
    return {
      status: "failed",
      runId: runId ?? undefined,
      error: envelope.message,
    };
  }

  // Resolve project by filename. A sticky binding (a human previously
  // confirmed this tracker's project) wins outright; otherwise fall back to
  // name similarity at the auto-match threshold.
  const extractedName = extractProjectNameFromFilename(fileName);
  const binding = await findActiveBindingForFile(fileName);

  let projectMatches: ProjectMatch[] = [];
  let bestMatch: ProjectMatch | undefined;
  let autoMappedProjectId: number | null = null;
  let autoMappedProjectName: string | null = null;
  let resolvedProjectName = extractedName;
  let matchSource: "binding" | "name" | "none" = "none";

  if (binding) {
    const boundName = await getProjectNameById(binding.projectId);
    if (boundName) {
      autoMappedProjectId = binding.projectId;
      autoMappedProjectName = boundName;
      resolvedProjectName = boundName;
      matchSource = "binding";
      await recordBindingUsage(binding.id);
    }
  }

  if (!autoMappedProjectId) {
    projectMatches = await findProjectMatches(extractedName);
    bestMatch = projectMatches[0];
    if (bestMatch && bestMatch.confidence >= AUTO_MATCH_THRESHOLD) {
      autoMappedProjectId = bestMatch.projectId;
      autoMappedProjectName = bestMatch.projectName;
      resolvedProjectName = bestMatch.projectName;
      matchSource = "name";
    }
  }

  // Run planner (only meaningful if we have a project id; otherwise everything is NEW).
  let plannerResult: Awaited<ReturnType<typeof runImportPlanner>> | null = null;
  try {
    plannerResult = await runImportPlanner(autoMappedProjectId, preview.normalization);
  } catch (err) {
    // Planner failures shouldn't lose the file — we still want to park it.
    console.warn(`[ScheduledImportV2] Planner failed for ${fileName}:`, err instanceof Error ? err.message : err);
  }

  // The existing scheduler conflict policy produces the auto-resolution map
  // and a coarse commit/park signal that the gate below consumes.
  const policyDecision = plannerResult
    ? resolveSchedulerConflictPolicy(plannerResult)
    : { decision: "park" as const, reason: "no_planner_result", resolutions: {} };
  const hasResurrections = (plannerResult?.resurrections?.length ?? 0) > 0;

  // Locked-period check — replicate the HTTP commit's effective-date set and
  // resolve it against the COS period locks with NO actor (the scheduler can't
  // override). A locked period parks gracefully with a reason instead of
  // erroring at commit time; a human commits later via the lock-aware review.
  let lockedPeriods: string[] = [];
  try {
    const lockEnforcement = await enforceCosPeriodLock({
      effectiveDates: collectCommitLockDates(preview.normalization),
      role: undefined,
    });
    lockedPeriods = lockEnforcement.lockedPeriods;
  } catch (lockErr) {
    // Fail safe: if the lock check itself errors, park rather than risk an
    // unattended write into a possibly-locked period.
    console.warn(
      `[ScheduledImportV2] period-lock check failed for ${fileName} (parking to be safe):`,
      lockErr instanceof Error ? lockErr.message : lockErr,
    );
    lockedPeriods = ["unknown"];
  }

  // Tighten "clean" for unattended auto-commit: anything not provably clean
  // parks (with a reason) instead of forcing/erroring. Clean runs still
  // auto-commit silently — this adds no prompt to the clean path (owner #1012).
  const gateSignals: AutoCommitGateSignals = {
    hasBlockers: preview.hasBlockers,
    lockedPeriods,
    errorOnRev: detectErrorOnRev(preview.normalization.categoryAllocations),
    missingAllocationOnNewLines: detectMissingAllocationOnNewLines(
      plannerResult,
      preview.normalization.categoryAllocations,
    ),
    softClosePct: computeSoftClosePct(plannerResult),
    hasResurrections,
    conflictPolicyParks: policyDecision.decision === "park",
  };
  const gate = decideSchedulerAutoCommit(gateSignals);
  const effectiveDecision: "commit" | "park" = gate.decision;

  const summaryJson = {
    ...(preview as unknown as Record<string, unknown>),
    schedulerV2: {
      triggeredBy,
      triggerType: "schedule",
      batchRunId,
      extractedProjectName: extractedName,
      autoMappedProjectId,
      autoMappedProjectName,
      matchSource,
      projectMatchCandidates: projectMatches,
      plannerImportMode: plannerResult?.importMode ?? null,
      plannerHasBlockingConflicts: plannerResult?.conflicts?.hasBlockingConflicts ?? false,
      policyDecision: policyDecision.decision,
      policyReason: policyDecision.reason,
      autoResolvedConflictCount: Object.keys(policyDecision.resolutions).length,
      // Tightened auto-commit gate: why this run auto-committed or parked.
      autoCommitGate: { decision: gate.decision, reason: gate.reason },
      lockedPeriods,
    },
  };

  // Insert the run as `preview` (matching the upload route's contract) when
  // we have a project and the policy says commit; otherwise as
  // `awaiting_review` so the UI surfaces it for human attention.
  const initialStatus = autoMappedProjectId && effectiveDecision === "commit"
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
  if (autoMappedProjectId && effectiveDecision === "commit") {
    try {
      // Net-delta guard: park (don't auto-commit) when this run would swing the
      // project's REV or COS beyond the threshold vs its current value. Uses the
      // dry-run preview for the "would-be" totals (no parallel formula).
      const parkedByDelta = await maybeParkOnNetDelta({
        runId: run.id,
        projectId: autoMappedProjectId,
        projectName: resolvedProjectName,
        v2ConflictResolutions: policyDecision.resolutions,
        gateSignals,
        summaryJson,
      });
      if (parkedByDelta) return { status: "parked", runId: run.id };

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
      console.log(`[ScheduledImportV2] Commit deferred for run ${run.id}: ${commitResult.status}`);
      return { status: "parked", runId: run.id };
    } catch (commitErr) {
      // Transaction failed — fold a structured failure envelope into the
      // existing run's summaryJson so the Tower can show what went wrong
      // alongside the parked-for-review row. The status is left at
      // `awaiting_review` (guarded so a racing UI commit isn't clobbered)
      // so the operator can still resolve manually.
      const envelope = buildImportFailureEnvelope("auto_commit", fileName, commitErr);
      console.error(`[ScheduledImportV2] ${envelope.message} (run ${run.id})`);
      try {
        await db.update(smartImportRuns)
          .set({
            status: "awaiting_review",
            summaryJson: { ...summaryJson, error: envelope },
          })
          .where(and(
            eq(smartImportRuns.id, run.id),
            inArray(smartImportRuns.status, ["preview", "awaiting_review"]),
          ));
      } catch { /* non-blocking */ }
      return {
        status: "failed",
        runId: run.id,
        error: envelope.message,
      };
    }
  }

  return { status: "parked", runId: run.id };
}

/**
 * Read-only project resolution mirroring processFileV2's binding + name-match
 * logic, used by the dedupe pre-pass to group same-project files in one cycle.
 * No side effects — binding-usage is recorded later, and only for the file
 * that actually becomes the candidate (inside processFileV2).
 */
async function resolveAutoMappedProjectId(fileName: string): Promise<number | null> {
  const binding = await findActiveBindingForFile(fileName);
  if (binding) {
    const boundName = await getProjectNameById(binding.projectId);
    if (boundName) return binding.projectId;
  }
  const extractedName = extractProjectNameFromFilename(fileName);
  const matches = await findProjectMatches(extractedName);
  const best = matches[0];
  return best && best.confidence >= AUTO_MATCH_THRESHOLD ? best.projectId : null;
}

/**
 * Park a quarantined file as an `awaiting_review` smart_import_runs row with a
 * clear reason. Quarantined files are NEVER auto-committed and NEVER reach the
 * finance write path — the operator decides in the Control Tower. The file is
 * a known duplicate/older revision, so we do not download it: there is no
 * preview and no content hash, just the reason for review.
 */
async function parkQuarantinedFile(
  q: QuarantinedFile,
  triggeredBy: string,
  batchRunId: string,
): Promise<number | null> {
  let projectId: number | null = null;
  let projectName = extractProjectNameFromFilename(q.file.name);
  if (q.kind === "older_revision" && typeof q.projectKey === "number") {
    const boundName = await getProjectNameById(q.projectKey);
    if (boundName) {
      projectId = q.projectKey;
      projectName = boundName;
    }
  }

  const summaryJson = {
    schedulerV2: {
      triggeredBy,
      triggerType: "schedule",
      batchRunId,
      quarantine: {
        kind: q.kind,
        reason: q.reason,
        chosenFile: q.chosenFile ?? null,
      },
    },
  };

  try {
    const [row] = await db
      .insert(smartImportRuns)
      .values({
        projectId,
        projectName,
        uploadedBy: null,
        sourceFileName: q.file.name,
        sourceFileHash: null,
        status: "awaiting_review",
        summaryJson,
      })
      .returning({ id: smartImportRuns.id });
    return row?.id ?? null;
  } catch (err) {
    console.error(
      `[ScheduledImportV2] Failed to park quarantined file ${q.file.name}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
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

  const result: ScheduledImportV2Result = {
    triggerType: opts.triggerType,
    triggeredBy: opts.triggeredBy,
    batchRunId: null,
    filesDiscovered: 0,
    filesCommitted: 0,
    filesParked: 0,
    filesSkipped: 0,
    filesFailed: 0,
    runIds: [],
    committedRunIds: [],
    errors: [],
    durationMs: 0,
  };

  let scheduledError: { code: string; message: string } | null = null;

  try {
    // Mock-mode short-circuit: in dev with no connector configured we do
    // a no-op success tick so the admin UI can see lastSuccessAt update,
    // proving the loop is alive.
    if (isConnectorMocked("ms-graph")) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    // Refresh the sp_files / change_ledger book-keeping so v2 stays
    // consistent with v1's diff detector. v1's runId-scoped ledger is
    // unused here.
    try {
      await detectChanges(
        settings.siteId,
        settings.driveId,
        settings.folderItemId || undefined,
        settings.folderPath || undefined,
      );
    } catch (err) {
      console.warn("[ScheduledImportV2] detectChanges housekeeping failed (non-blocking):", err instanceof Error ? err.message : err);
    }

    // List current files in the configured folder. The listing now includes
    // Office lock files and "conflicted copy" duplicates (previously dropped in
    // sharepoint.ts) so the dedupe pass below can skip/quarantine them instead
    // of letting them silently disappear.
    let folderChildren: Array<{
      id: string;
      name: string;
      size?: number;
      lastModifiedDateTime?: string;
    }>;
    try {
      folderChildren = await listFolderChildren(
        settings.driveId,
        settings.folderItemId || undefined,
        settings.folderPath || undefined,
      );
    } catch (err) {
      // Surface the real Graph code/message (captured in ApiError.details) so the
      // failure banner is diagnosable instead of just "Microsoft Graph failed".
      if (err instanceof ApiError) {
        const d = err.details ?? {};
        const extra = [d.graphCode, d.graphMessage, d.requestId ? `requestId=${d.requestId}` : undefined]
          .filter(Boolean)
          .join(" · ");
        throw new ApiError(
          err.statusCode,
          err.code,
          `SharePoint folder listing failed: ${err.message}${extra ? ` — ${extra}` : ""}`,
          err.details,
          err.nextAction,
        );
      }
      throw new Error(`SharePoint folder listing failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    result.filesDiscovered = folderChildren.length;
    // One batch id per scheduler tick so the Tower can group / filter
    // every file from this folder pickup under a single "Folder Import
    // Batch" view (see import-control-tower.tsx ?batchRunId=...).
    const batchRunId = makeBatchRunId();
    result.batchRunId = batchRunId;

    // Ingest hygiene + per-project dedupe: one project = one candidate per
    // cycle. Junk is skipped (debug log only), duplicate / older-revision files
    // are quarantined as `awaiting_review` (never auto-committed), and only the
    // surviving candidates flow through the unchanged clean path below.
    const plan = await planFolderIngest(
      folderChildren.map((c) => ({
        id: c.id,
        name: c.name,
        size: typeof c.size === "number" ? c.size : null,
        lastModifiedDateTime: typeof c.lastModifiedDateTime === "string" ? c.lastModifiedDateTime : null,
      })),
      resolveAutoMappedProjectId,
    );

    // (1) Skip junk — Office lock files + zero-byte files. No run row is
    // created and nothing reaches finance; we only debug-log so the reason is
    // discoverable without parking an empty review.
    for (const skipped of plan.skipped) {
      console.debug(`[ScheduledImportV2] Skipping ${skipped.reason}: ${skipped.file.name}`);
      result.filesSkipped++;
    }

    // (2) Quarantine duplicates / older revisions — parked for human review,
    // surfaced in the awaiting_review UI with the reason, never auto-committed.
    for (const quarantined of plan.quarantined) {
      const runId = await parkQuarantinedFile(quarantined, opts.triggeredBy, batchRunId);
      result.filesParked++;
      if (runId) {
        result.runIds.push(runId);
        await maybeSendImportAlert("needs_review", runId);
      }
    }

    // (3) Candidates — the clean single-file flow, byte-for-byte unchanged.
    for (const child of plan.candidates) {
      try {
        const outcome = await processFileV2(
          { id: child.id, name: child.name, driveId: settings.driveId },
          opts.triggeredBy,
          batchRunId,
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
          await maybeSendImportAlert("needs_review", outcome.runId ?? null);
        } else if (outcome.status === "skipped") {
          result.filesSkipped++;
        } else {
          result.filesFailed++;
          if (outcome.error) result.errors.push({ fileName: child.name, error: outcome.error });
          if (outcome.runId) result.runIds.push(outcome.runId);
          await maybeSendImportAlert("failed", outcome.runId ?? null);
        }
      } catch (err) {
        result.filesFailed++;
        result.errors.push({
          fileName: child.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  } catch (err) {
    scheduledError = {
      code: err instanceof ApiError ? err.code : "SCHEDULED_IMPORT_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
    throw err;
  } finally {
    // Persist tick outcome unconditionally so the admin UI never shows
    // "Last run: Never" while ticks are actually firing. Last-error
    // columns are cleared on success, set on failure.
    const now = new Date();
    const base = {
      siteId: settings.siteId,
      driveId: settings.driveId,
      folderItemId: settings.folderItemId,
      folderPath: settings.folderPath,
      intervalMinutes: settings.intervalMinutes,
      enabled: settings.enabled,
      updatedBy: settings.updatedBy,
      lastRunAt: now,
    };
    try {
      if (scheduledError) {
        await storage.upsertSpSettings({
          ...base,
          lastErrorAt: now,
          lastErrorCode: scheduledError.code,
          lastErrorMessage: scheduledError.message,
          lastSuccessAt: settings.lastSuccessAt ?? null,
        });
      } else {
        await storage.upsertSpSettings({
          ...base,
          lastSuccessAt: now,
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        });
      }
    } catch (persistErr) {
      console.warn(
        "[ScheduledImportV2] Failed to persist tick outcome:",
        persistErr instanceof Error ? persistErr.message : persistErr,
      );
    }
    result.durationMs = Date.now() - startedAt;
  }
}
