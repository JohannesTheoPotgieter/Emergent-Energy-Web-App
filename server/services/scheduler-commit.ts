/**
 * Scheduler commit service — programmatic commit path for the Smart
 * Import v2 auto-import scheduler.
 *
 * Mirrors the transaction logic in `smart-import-routes.ts`'s
 * `POST /api/smart-import/:runId/commit` handler but drops the
 * interactive checks the scheduler can't satisfy:
 *
 *   - manual-edits-warning (no human to choose keep / overwrite — the
 *     scheduler conflict policy parks instead)
 *   - duplicate-project-candidate (scheduler only commits runs whose
 *     project_id was already auto-matched at ≥0.85 confidence in
 *     scheduled-import-v2.ts; runs without a project are parked)
 *   - previously-deleted-project re-creation guard
 *   - unresolved-blockers gate (parked at preview time)
 *
 * The transaction block (atomic claim → matchers → conflict engine →
 * write_*_incremental → auxiliary writes → final mark-as-committed) is
 * duplicated from the HTTP handler. This is intentional, accepting
 * short-term duplication in exchange for not touching the existing
 * 1,199-line HTTP handler. A follow-up refactor can extract the shared
 * transaction body once the scheduler path has run in production.
 *
 * **Returns a discriminated-union result; never throws for business
 * errors.** Unexpected exceptions (DB connectivity, etc.) still bubble.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { IMPORT_FILE_ALWAYS_WINS } from "../imports/import-conflict-policy";
import {
  smartImportRuns,
  normalizedCostLines,
  normalizedRevenueLines,
  normalizedExecutionPhases,
  projectInfo,
  workItems,
  workItemAssignments,
  workItemDependencies,
  expenseTaskLinks,
  importLogs,
  conflictResolutionLog,
  categoryRevenueAllocations,
} from "@shared/schema";
import { runImportPlanner } from "../lib/import/planner";
import {
  writePlanIncremental,
  writeRevenueIncremental,
  writeExpenditureIncremental,
  writeActualLineRows,
  writeProjectMetadata,
  writeRevenueSummary,
  mergeConflictsToWizardRows,
  type IncrementalCommitResult,
} from "../lib/import/commit-executor";
import { refreshProvenanceForProjects } from "../lib/finance/provenance";
import {
  refreshReconciliationForProjects,
  getReconciliationDetail,
  type ReconProjectDetail,
} from "./reconciliation-service";
import { newImportMetrics, emitImportMetrics, threeWayMergeEnabled } from "../lib/import/feature-flags";
import { matchRows, generateBusinessKey, type SectionType, type MatchedRow } from "../lib/import/row-matcher";
import { runConflictEngine, type RowMergeResult } from "../lib/import/conflict-engine";
import {
  loadCurrentPlanRows,
  loadCurrentRevenueRows,
  loadCurrentCostRows,
  loadBaselineForPlanner,
  detectImportMode,
} from "../lib/import/baseline";
import { materializeDerivatives } from "../lib/import/derivative-materializer";
import { syncProjectSplitTables } from "../lib/project-info-sync";
import { recordImportChange } from "../lib/audit/diff-engine";
import { logAudit } from "../audit-logger";
import { refreshProjectMetricsAsync } from "./dashboard-metrics";
import { normalizeAllocationConfidence } from "../lib/import/utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SchedulerCommitResult =
  | {
      status: "committed";
      runId: number;
      counts: { planTasks: number; revenueLines: number; costLines: number; executionPhases: number };
      v2: IncrementalCommitResult | null;
      durationMs: number;
    }
  | {
      status: "skipped_already_committed";
      runId: number;
    }
  | {
      status: "skipped_no_normalization";
      runId: number;
    }
  | {
      status: "skipped_no_project_id";
      runId: number;
      reason: string;
    }
  | {
      status: "skipped_recency_older";
      runId: number;
      lastCommittedAt: Date | null;
      currentUploadedAt: Date | null;
    }
  | {
      status: "skipped_recency_equal";
      runId: number;
      lastCommittedAt: Date | null;
      currentUploadedAt: Date | null;
    }
  | {
      status: "blocked_v2_conflicts";
      runId: number;
      conflicts: Array<{
        rowKey: string;
        fieldName: string;
        mergeCase: string;
      }>;
    }
  | {
      status: "blocked_writer_engine_conflicts";
      runId: number;
      conflicts: ReturnType<typeof mergeConflictsToWizardRows>;
    }
  | {
      /**
       * Dry-run preview only — applies the import inside a transaction that is
       * ALWAYS rolled back, then returns the reconciliation the project WOULD
       * have after this commit. Persists nothing; touches no reported number.
       */
      status: "dry_run_preview";
      runId: number;
      recon: ReconProjectDetail | null;
    };

export interface SchedulerCommitOptions {
  runId: number;
  /**
   * v2 conflict resolutions from the scheduler's policy module.
   * `{ "rowKey::fieldName": "keep_app" | "accept_file" }`.
   * Empty when the conservative policy parked the run.
   */
  v2ConflictResolutions?: Record<string, "keep_app" | "accept_file">;
  /**
   * When true, apply every write inside the transaction exactly as a real
   * commit would, compute the resulting reconciliation, then ROLL BACK so
   * nothing persists. Used by the review screen's post-commit preview. The
   * run is never marked committed and no audit / metrics rows are written.
   */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Commit a Smart Import v2 run programmatically (no HTTP context).
 * Used by the 30-min SharePoint scheduler when the conflict policy
 * decided the run can be safely auto-committed.
 *
 * Never throws on business errors — returns a tagged result. Logs but
 * does not re-throw transaction errors; instead writes the failure to
 * `import_logs` and re-throws so the orchestrator's outer catch can
 * tally it as `failed`.
 */
export async function commitSmartImportRunAsSystem(
  opts: SchedulerCommitOptions,
): Promise<SchedulerCommitResult> {
  const startedAt = Date.now();
  const { runId, v2ConflictResolutions = {} } = opts;

  const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
  if (!run) {
    return { status: "skipped_no_normalization", runId };
  }
  if (run.status === "committed") {
    return { status: "skipped_already_committed", runId };
  }

  const summary = run.summaryJson as any;
  const norm = summary?.normalization;
  if (!norm) {
    return { status: "skipped_no_normalization", runId };
  }

  const projectId = run.projectId;
  const projectName = run.projectName;
  if (!projectId) {
    return {
      status: "skipped_no_project_id",
      runId,
      reason: "scheduler only commits runs with a matched projectId",
    };
  }

  // ── Recency check ──
  const [lastCommitted] = await db
    .select()
    .from(smartImportRuns)
    .where(
      and(
        eq(smartImportRuns.projectName, projectName),
        eq(smartImportRuns.status, "committed"),
      ),
    )
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);

  if (lastCommitted) {
    const lastTs = lastCommitted.committedAt ? new Date(lastCommitted.committedAt).getTime() : 0;
    const currentTs = run.uploadedAt ? new Date(run.uploadedAt).getTime() : 0;
    if (currentTs && lastTs && currentTs < lastTs) {
      return {
        status: "skipped_recency_older",
        runId,
        lastCommittedAt: lastCommitted.committedAt,
        currentUploadedAt: run.uploadedAt,
      };
    }
    if (currentTs && lastTs && Math.abs(currentTs - lastTs) < 60_000) {
      return {
        status: "skipped_recency_equal",
        runId,
        lastCommittedAt: lastCommitted.committedAt,
        currentUploadedAt: run.uploadedAt,
      };
    }
  }

  // ── v2 conflict pre-check ──
  // The policy module should have already decided this is safe, but
  // re-run the planner inside the lock-free window so we 409 if data
  // moved since the orchestrator's earlier check.
  try {
    const plannerResult = await runImportPlanner(projectId, norm);
    if (plannerResult.conflicts?.hasBlockingConflicts && !IMPORT_FILE_ALWAYS_WINS) {
      const unresolvedRows = plannerResult.conflicts.allRows
        .filter((r) => r.conflictStatus === "HAS_CONFLICTS")
        .flatMap((r) =>
          r.fields
            .filter((f) => f.requiresDecision)
            .map((f) => ({
              rowKey: r.rowKey,
              fieldName: f.fieldName,
              mergeCase: f.mergeCase,
            })),
        );
      const allResolved = unresolvedRows.every(
        (uc) => v2ConflictResolutions[`${uc.rowKey}::${uc.fieldName}`],
      );
      if (!allResolved) {
        return { status: "blocked_v2_conflicts", runId, conflicts: unresolvedRows };
      }
    }
  } catch (planErr) {
    console.warn(
      "[SchedulerCommit] v2 conflict re-check failed (continuing):",
      planErr instanceof Error ? planErr.message : String(planErr),
    );
  }

  // ── Transaction ──
  const counts = { planTasks: 0, revenueLines: 0, costLines: 0, executionPhases: 0 };
  let v2Result: IncrementalCommitResult | null = null;
  let writerEngineConflicts: ReturnType<typeof mergeConflictsToWizardRows> | null = null;
  let dryRunRecon: ReconProjectDetail | null = null;

  try {
    await db.transaction(async (tx: any) => {
      // Atomic claim — prevents two concurrent calls from double-committing
      const claimResult = await tx.execute(sql`
        UPDATE smart_import_runs
        SET status = 'awaiting_review'
        WHERE id = ${runId}
          AND status IN ('preview', 'awaiting_review')
        RETURNING id
      `);
      const claimed = (claimResult.rows ?? claimResult) as Array<{ id: number }>;
      if (!claimed || claimed.length === 0) {
        // H1: tag the throw with a code so the outer catch can return
        // `skipped_already_committed` rather than reporting a false failure
        // when a concurrent UI commit got there first.
        throw Object.assign(
          new Error("Import run is no longer committable (already committed, rolled back, or superseded)"),
          { status: 409, code: "claim_lost" },
        );
      }

      const commitTimestamp = new Date();
      const baselineInfo = await detectImportMode(projectId);

      const [planRows, revenueRows, costRows, baselineNorm] = await Promise.all([
        loadCurrentPlanRows(projectId),
        loadCurrentRevenueRows(projectId),
        loadCurrentCostRows(projectId),
        baselineInfo.importMode === "INCREMENTAL" ? loadBaselineForPlanner(projectId) : Promise.resolve(null),
      ]);

      const matchedPlan: MatchedRow[] = norm.planTasks?.length > 0 || planRows.length > 0
        ? matchRows("PLAN" as SectionType, projectId, norm.planTasks || [], planRows as any)
        : [];
      const matchedRevenue: MatchedRow[] = (norm.revenueLines?.length ?? 0) > 0
        ? matchRows("REVENUE" as SectionType, projectId, norm.revenueLines || [], revenueRows as any)
        : [];
      const matchedCost: MatchedRow[] = (norm.costLines?.length ?? 0) > 0
        ? matchRows("EXPENDITURE" as SectionType, projectId, norm.costLines || [], costRows as any)
        : [];

      const conflictMergeResults = new Map<string, RowMergeResult>();
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

      const v2Decisions = v2ConflictResolutions;

      // Pre-import work_items snapshot for rollback
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
        } catch (snapErr) {
          console.warn("[SchedulerCommit] Pre-import snapshot failed (non-blocking):", snapErr instanceof Error ? snapErr.message : String(snapErr));
        }
      }

      // Per-section incremental writes
      let planResult: any = null;
      if (matchedPlan.length > 0) {
        planResult = await writePlanIncremental({
          tx, projectId, projectName, runId, userId: null,
          matchedRows: matchedPlan,
          mergeResults: conflictMergeResults,
          conflictDecisions: v2Decisions,
          workItemsTable: workItems,
          workItemDependenciesTable: workItemDependencies,
          workItemAssignmentsTable: workItemAssignments,
        });
        counts.planTasks = planResult.counts.inserted + planResult.counts.updated;
      }

      let revenueResult: any = null;
      if (matchedRevenue.length > 0) {
        revenueResult = await writeRevenueIncremental({
          tx, projectId, projectName, runId, userId: null,
          matchedRows: matchedRevenue,
          mergeResults: conflictMergeResults,
          conflictDecisions: v2Decisions,
          commitTimestamp,
        });
        counts.revenueLines = revenueResult.counts.inserted + revenueResult.counts.updated;
      }

      let costResult: any = null;
      if (matchedCost.length > 0) {
        costResult = await writeExpenditureIncremental({
          tx, projectId, projectName, runId, userId: null,
          matchedRows: matchedCost,
          mergeResults: conflictMergeResults,
          conflictDecisions: v2Decisions,
          commitTimestamp,
        });
        counts.costLines = costResult.counts.inserted + costResult.counts.updated;
      }

      // Writer-engine conflict surface — abort if any field-level conflicts slipped through
      const collisions = [
        ...(planResult?.mergeConflicts ?? []),
        ...(revenueResult?.mergeConflicts ?? []),
        ...(costResult?.mergeConflicts ?? []),
      ];
      if (collisions.length > 0) {
        writerEngineConflicts = mergeConflictsToWizardRows(collisions);
        const err = new Error(`Three-way merge surfaced ${collisions.length} unresolved field-level conflict(s).`);
        (err as any).status = 409;
        (err as any).code = "v2_conflicts_detected";
        throw err;
      }

      // Auxiliary writes (non-blocking)
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
        console.error("[SchedulerCommit] Auxiliary writer failure (non-blocking):", auxErr);
      }

      // Per-section metrics
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

      // S09: category_revenue_allocations
      const catAllocs = norm.categoryAllocations as Array<{
        categoryNumber: string; categoryName: string; categoryKey: string;
        categorySortOrder: number; revenueAllocation: number | null;
        cosTotalCosted: number | null; budgetTotal: number | null;
        allocationSource: string; sourceSheet: string; sourceRow: number;
      }> | undefined;

      const catAllocIdByKey = new Map<string, number>();
      if (catAllocs && catAllocs.length > 0) {
        await tx.update(categoryRevenueAllocations)
          .set({ effectiveTo: commitTimestamp })
          .where(and(
            eq(categoryRevenueAllocations.projectId, projectId),
            isNull(categoryRevenueAllocations.effectiveTo),
          ));

        for (const ca of catAllocs) {
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

      // S10: populate category_key + category_allocation_id on active NCL rows
      if (catAllocIdByKey.size > 0) {
        const catNameToKeyId = new Map<string, { key: string; id: number }>();
        for (const ca of catAllocs!) {
          catNameToKeyId.set(ca.categoryName.toLowerCase(), { key: ca.categoryKey, id: catAllocIdByKey.get(ca.categoryKey)! });
          catNameToKeyId.set(ca.categoryKey.toLowerCase(), { key: ca.categoryKey, id: catAllocIdByKey.get(ca.categoryKey)! });
        }

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

      // S11: noRevenueLinked recon
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
        } catch (reconErr) {
          console.warn("[SchedulerCommit] noRevenueLinked recon failed (non-blocking):", reconErr instanceof Error ? reconErr.message : String(reconErr));
        }
      }

      // Dry-run preview: cost lines, actuals and category allocations are now
      // written in this transaction, so the §3.3 reconciliation reflects the
      // post-commit state. Capture it and roll the whole transaction back —
      // the review screen shows this without persisting anything.
      if (opts.dryRun) {
        dryRunRecon = await getReconciliationDetail(tx, projectId);
        throw Object.assign(new Error("dry-run rollback"), { code: "dry_run_rollback" });
      }

      // S11.5: provenance / reconciliation refresh — recompute the canonical
      // § 3.3 revenue_derived for this project's live actuals and persist
      // revenue_derived / revenue_stored / recon_delta / recon_exceeds,
      // snapshot-guarded. Keeps the reconciliation columns current on every
      // scheduled commit; does NOT change which value any read path reports.
      // Non-blocking, gated to imports that could have moved a finance input.
      const provenanceTouched =
        !!costResult ||
        (Array.isArray(catAllocs) && catAllocs.length > 0) ||
        (Array.isArray(norm.actualLineRows) && norm.actualLineRows.length > 0);
      if (provenanceTouched) {
        try {
          const prov = await refreshProvenanceForProjects(tx, [projectId]);
          console.log(
            `[SchedulerCommit] provenance refresh: ${prov.written} actuals · ${prov.flagged} flagged (|Δ| > R1) · max |recon_delta| = ${prov.maxAbsDelta.toFixed(2)}`,
          );
        } catch (provErr) {
          console.warn(
            "[SchedulerCommit] provenance refresh failed (non-blocking):",
            provErr instanceof Error ? provErr.message : String(provErr),
          );
        }

        // P2.2 — refresh app-vs-tracker reconciliation status into
        // financial_reconciliation for this project. Read-only; non-blocking.
        try {
          const recon = await refreshReconciliationForProjects(tx, [projectId]);
          console.log(
            `[SchedulerCommit] reconciliation refresh: ${recon.rowsWritten} row(s) written, ${recon.rowsUnchanged} unchanged`,
          );
        } catch (reconErr) {
          console.warn(
            "[SchedulerCommit] reconciliation refresh failed (non-blocking):",
            reconErr instanceof Error ? reconErr.message : String(reconErr),
          );
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

      // Execution phases (simple re-insert)
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

      // Update project metadata
      const detectedInfo = summary.detection?.projectInfo;
      if (detectedInfo) {
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
        if (detectedInfo.practicalCompletionDate) {
          updates.practicalCompletionActual = detectedInfo.practicalCompletionDate;
        }
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await tx.update(projectInfo).set(updates).where(eq(projectInfo.id, projectId));
          await syncProjectSplitTables(projectId, updates, tx);
        }
      }

      // S12: project_revenue_summary refresh
      try {
        await materializeDerivatives({
          tx, projectId, projectName, runId, commitTimestamp, norm,
        });
      } catch (matErr) {
        console.warn("[SchedulerCommit] project_revenue_summary refresh failed (non-blocking):", matErr instanceof Error ? matErr.message : String(matErr));
      }

      // S13: re-link expense_task_links
      if (costResult && (costResult.counts.updated > 0 || costResult.counts.inserted > 0)) {
        try {
          const oldToNewNcl = new Map<number, number>();
          if (costResult.updatedIds && costResult.insertedIds) {
            for (let i = 0; i < costResult.updatedIds.length; i++) {
              if (i < costResult.insertedIds.length) {
                oldToNewNcl.set(costResult.updatedIds[i], costResult.insertedIds[i]);
              }
            }
          }

          const activeNclIds = new Set<number>();
          const activeNclForLinks = await tx.select({ id: normalizedCostLines.id })
            .from(normalizedCostLines)
            .where(and(eq(normalizedCostLines.projectId, projectId), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))));
          for (const r of activeNclForLinks) activeNclIds.add(r.id);

          const projectLinks = await tx.select().from(expenseTaskLinks)
            .where(eq(expenseTaskLinks.projectName, projectName));

          for (const link of projectLinks) {
            const canonId = link.canonicalExpenseId;
            if (canonId == null) continue;
            if (oldToNewNcl.has(canonId)) {
              await tx.update(expenseTaskLinks)
                .set({ canonicalExpenseId: oldToNewNcl.get(canonId)! })
                .where(eq(expenseTaskLinks.id, link.id));
            } else if (!activeNclIds.has(canonId)) {
              await tx.update(expenseTaskLinks)
                .set({ canonicalExpenseId: null })
                .where(eq(expenseTaskLinks.id, link.id));
            }
          }
        } catch (linkErr) {
          console.warn("[SchedulerCommit] Canonical link re-pointing failed (non-blocking):", linkErr instanceof Error ? linkErr.message : String(linkErr));
        }
      }

      // Finalize: mark as committed (with `committedBy=null` so the system actor is auditable)
      const totalAttempted = (norm.planTasks?.length || 0) + (norm.revenueLines?.length || 0) + (norm.costLines?.length || 0) + (norm.executionPhases?.length || 0);
      const totalSucceeded = counts.planTasks + counts.revenueLines + counts.costLines + counts.executionPhases;
      const totalFailed = totalAttempted - totalSucceeded;
      const detectedSections: string[] = [];
      if (norm.planTasks?.length > 0) detectedSections.push("PLAN");
      if (norm.revenueLines?.length > 0) detectedSections.push("REVENUE");
      if (norm.costLines?.length > 0) detectedSections.push("EXPENDITURE");

      await tx.update(smartImportRuns).set({
        status: "committed",
        committedAt: new Date(),
        committedBy: null,
        recordsAttempted: totalAttempted,
        recordsSucceeded: totalSucceeded,
        recordsFailed: totalFailed,
        importType: detectedSections.join(","),
      }).where(eq(smartImportRuns.id, runId));

      // Log v2 conflict resolution decisions (system actor)
      if (Object.keys(v2Decisions).length > 0) {
        try {
          for (const [key, decision] of Object.entries(v2Decisions)) {
            const sepIdx = key.lastIndexOf("::");
            if (sepIdx < 0) continue;
            const rowKey = key.substring(0, sepIdx);
            const fieldName = key.substring(sepIdx + 2);
            await tx.insert(conflictResolutionLog).values({
              importRunId: runId,
              entityType: "v2_3way_merge",
              entityId: rowKey,
              fieldName,
              manualValue: decision === "keep_app" ? "preserved" : null,
              importValue: decision === "accept_file" ? "applied" : null,
              decision: decision === "keep_app" ? "KEEP_MANUAL" : "OVERWRITE_WITH_IMPORT",
              decidedByUserId: null,
              decidedByName: "scheduler-auto",
            });
          }
        } catch (v2ResLogErr) {
          console.warn("[SchedulerCommit] v2 conflict resolution logging failed (non-blocking):", v2ResLogErr instanceof Error ? v2ResLogErr.message : String(v2ResLogErr));
        }
      }
    });
  } catch (err) {
    // Dry-run preview: the rollback we deliberately threw after computing the
    // reconciliation inside the transaction. Nothing was persisted — return
    // the captured preview, not a failure.
    if ((err as any)?.code === "dry_run_rollback") {
      return { status: "dry_run_preview", runId, recon: dryRunRecon };
    }
    // H1: claim-race — a concurrent UI commit got there first. Return
    // `skipped_already_committed` instead of reporting a false failure so
    // the orchestrator doesn't tally a scheduler "failure" and so we don't
    // pollute `import_logs` with a fake failure row.
    if ((err as any)?.status === 409 && (err as any)?.code === "claim_lost") {
      return { status: "skipped_already_committed", runId };
    }
    // Writer-engine conflict surfaced from inside the transaction → return decision, not throw
    if ((err as any)?.status === 409 && (err as any)?.code === "v2_conflicts_detected" && writerEngineConflicts) {
      return { status: "blocked_writer_engine_conflicts", runId, conflicts: writerEngineConflicts };
    }
    // M2: capture PG cause detail (constraint / table / column) so a
    // FK / NOT NULL violation can be diagnosed without re-running the import.
    const pgCause = (err as any)?.cause;
    const baseMsg = err instanceof Error ? err.message : String(err);
    const causeMsg = pgCause
      ? ` | PG: ${pgCause?.message || ""} [${pgCause?.code || ""}] constraint=${pgCause?.constraint || ""} detail=${pgCause?.detail || ""}`
      : "";
    console.error("[SchedulerCommit] Transaction failed for run", runId, err);
    if (pgCause) {
      console.error("[SchedulerCommit] PostgreSQL cause:", {
        message: pgCause?.message,
        detail: pgCause?.detail,
        code: pgCause?.code,
        constraint: pgCause?.constraint,
        table: pgCause?.table,
        column: pgCause?.column,
      });
    }
    try {
      await db.insert(importLogs).values({
        importRunId: runId,
        fileName: run.sourceFileName || "unknown",
        importedByUserId: null,
        importedByName: "scheduler",
        projectName: projectName || null,
        status: "failed",
        errorMessage: (baseMsg + causeMsg).substring(0, 2000),
      });
    } catch (_) { /* non-blocking */ }
    throw err;
  }

  // Post-commit: audit + dashboard metrics refresh
  try {
    await recordImportChange({
      actorUserId: undefined,
      smartImportRunId: runId,
      entityType: "smart_import",
      entityId: String(runId),
      projectName: projectName || undefined,
      projectId: projectId || undefined,
      action: "IMPORT_COMMIT",
      summary: `Scheduler import committed: ${counts.planTasks} tasks, ${counts.revenueLines} revenue, ${counts.costLines} cost, ${counts.executionPhases} phases`,
      fileMetadata: { fileName: run.sourceFileName || "unknown", fileHash: run.sourceFileHash || "" },
      fields: [
        ...(counts.planTasks > 0 ? [{ fieldName: "planTasks", oldValue: null, newValue: String(counts.planTasks), dataType: "number" }] : []),
        ...(counts.revenueLines > 0 ? [{ fieldName: "revenueLines", oldValue: null, newValue: String(counts.revenueLines), dataType: "number" }] : []),
        ...(counts.costLines > 0 ? [{ fieldName: "costLines", oldValue: null, newValue: String(counts.costLines), dataType: "number" }] : []),
        ...(counts.executionPhases > 0 ? [{ fieldName: "executionPhases", oldValue: null, newValue: String(counts.executionPhases), dataType: "number" }] : []),
      ],
    });
  } catch (auditErr) {
    console.warn("[SchedulerCommit] Audit logging failed (non-blocking):", auditErr instanceof Error ? auditErr.message : String(auditErr));
  }

  // M1: also write to `audit_events` so scheduler-committed runs appear in
  // standard audit reports alongside user-committed runs. Mirrors the HTTP
  // handler's `logAuditFromReq({ action: "commit" })` at smart-import-routes.ts:2962.
  try {
    await logAudit({
      userId: undefined,
      userName: "scheduler",
      actorRole: "SYSTEM",
      entityType: "smart_import",
      entityId: String(runId),
      action: "commit",
      projectName: projectName || undefined,
      source: "IMPORT",
      changesJson: { counts, preservedOverrides: 0, preservedManualEdits: 0, triggeredBy: "scheduler" },
    });
  } catch (auditErr) {
    console.warn("[SchedulerCommit] audit_events write failed (non-blocking):", auditErr instanceof Error ? auditErr.message : String(auditErr));
  }

  try {
    await db.insert(importLogs).values({
      importRunId: runId,
      fileName: run.sourceFileName || "unknown",
      importedByUserId: null,
      importedByName: "scheduler",
      projectName: projectName || null,
      status: "success",
      rowsAttempted: counts.planTasks + counts.revenueLines + counts.costLines + counts.executionPhases,
      rowsWritten: counts.planTasks + counts.revenueLines + counts.costLines + counts.executionPhases,
      rowsSkipped: 0,
      rowsRejected: 0,
      conflictsDetected: 0,
      conflictsResolved: Object.keys(v2ConflictResolutions).length,
      summaryJson: { counts, source: "scheduler" } as any,
    });
  } catch (logErr) {
    console.warn("[SchedulerCommit] import_logs write failed (non-blocking):", logErr instanceof Error ? logErr.message : String(logErr));
  }

  refreshProjectMetricsAsync(projectId);

  return {
    status: "committed",
    runId,
    counts,
    v2: v2Result,
    durationMs: Date.now() - startedAt,
  };
}
