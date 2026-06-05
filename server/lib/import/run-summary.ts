/**
 * Presentation-friendly summary of a `smart_import_runs` row.
 *
 * Shared so the per-project status card, the "needs attention" list, and the
 * Teams alert all describe a run the same way — one place to map raw status +
 * diagnostics into a human state + reason.
 */

import type { SmartImportRun } from "@shared/schema";

export type ImportRunState = "up_to_date" | "needs_review" | "failed" | "in_progress";

export interface ImportRunSummaryView {
  runId: number;
  projectId: number | null;
  projectName: string;
  sourceFileName: string;
  state: ImportRunState;
  status: string;
  /** committedAt when committed, else uploadedAt — "last touched". */
  lastImportedAt: Date | null;
  recordsChanged: number | null;
  /** Why it needs attention / failed (null when up to date). */
  reason: string | null;
}

export function deriveImportRunState(status: string): ImportRunState {
  switch (status) {
    case "committed":
      return "up_to_date";
    case "awaiting_review":
      return "needs_review";
    case "failed":
      return "failed";
    default:
      // preview / superseded / rolled_back
      return "in_progress";
  }
}

export function summarizeImportRun(run: SmartImportRun): ImportRunSummaryView {
  const summary = (run.summaryJson ?? {}) as Record<string, unknown>;
  const schedulerV2 = summary.schedulerV2 as Record<string, unknown> | undefined;
  const errorObj = summary.error as { message?: string } | undefined;

  let reason: string | null = null;
  if (run.status === "failed") {
    reason = errorObj?.message ?? (summary.message as string | undefined) ?? "Import failed";
  } else if (run.status === "awaiting_review") {
    if (schedulerV2?.plannerHasBlockingConflicts) {
      reason = "Conflicts need a decision";
    } else if (schedulerV2 && !schedulerV2.autoMappedProjectId) {
      reason = "No confident project match";
    } else {
      reason = (schedulerV2?.policyReason as string | undefined) ?? "Parked for review";
    }
  }

  return {
    runId: run.id,
    projectId: run.projectId,
    projectName: run.projectName,
    sourceFileName: run.sourceFileName,
    state: deriveImportRunState(run.status),
    status: run.status,
    lastImportedAt: run.committedAt ?? run.uploadedAt,
    recordsChanged: run.recordsSucceeded ?? null,
    reason,
  };
}
