/**
 * Pure aggregation for the "last automatic tracker pull" Settings card
 * (Integration Statuses → /admin/integrations).
 *
 * Given recent `smart_import_runs` rows (newest-first), this groups the most
 * recent Scheduled Import v2 batch — every file processed in one scheduler tick
 * shares a `summaryJson.schedulerV2.batchRunId` (see
 * server/services/scheduled-import-v2.ts) — and summarises per-file outcomes
 * plus headline counts. No DB or I/O, so it is unit-testable and keeps the
 * (already large) smart-import route file from growing.
 */

export interface SmartImportRunRow {
  id: number;
  projectId: number | null;
  projectName: string | null;
  sourceFileName: string | null;
  status: string | null;
  committedAt: Date | string | null;
  uploadedAt: Date | string | null;
  summaryJson: unknown;
}

export interface LastAutoPullFile {
  runId: number;
  projectId: number | null;
  projectName: string | null;
  fileName: string | null;
  status: string;
  committedAt: Date | string | null;
  uploadedAt: Date | string | null;
  matchSource: string | null;
  /** Which tracker sections this file moved (or would move). */
  sections: string[];
  changeCounts: { plan: number; revenue: number; expenditure: number };
  /** Human-readable reason for a hold / failure, else null. */
  reason: string | null;
}

export interface LastAutoPullBatch {
  batchRunId: string;
  ranAt: Date | string | null;
  counts: { total: number; committed: number; needsReview: number; failed: number; inProgress: number };
  files: LastAutoPullFile[];
}

/** Narrow an unknown jsonb value to a readable record (never throws). */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Summarise the most recent *automatic* (scheduler) tracker pull, or null when
 * no scheduler batch is present in the supplied rows.
 *
 * `rows` must be ordered newest-first (the route passes them ordered by
 * uploadedAt DESC) — the first scheduler run carries the most recent batch id.
 */
export function summarizeLastAutoPull(rows: SmartImportRunRow[]): LastAutoPullBatch | null {
  const schedulerRuns = rows.filter((r) => {
    const sched = asRecord(asRecord(r.summaryJson).schedulerV2);
    return typeof sched.batchRunId === "string" && (sched.batchRunId as string).length > 0;
  });
  if (schedulerRuns.length === 0) return null;

  const latestBatchId = asRecord(asRecord(schedulerRuns[0].summaryJson).schedulerV2)
    .batchRunId as string;
  const batchRuns = schedulerRuns.filter(
    (r) => asRecord(asRecord(r.summaryJson).schedulerV2).batchRunId === latestBatchId,
  );

  const files: LastAutoPullFile[] = batchRuns.map((run) => {
    const summary = asRecord(run.summaryJson);
    const sched = asRecord(summary.schedulerV2);
    const norm = asRecord(summary.normalization);

    // Which parts of the tracker this file moved — the substance of "what
    // changed". Counts come from the preview normalization stored on the run.
    const changeCounts = {
      plan: Array.isArray(norm.planTasks) ? norm.planTasks.length : 0,
      revenue: Array.isArray(norm.revenueLines) ? norm.revenueLines.length : 0,
      expenditure: Array.isArray(norm.costLines) ? norm.costLines.length : 0,
    };
    const sections: string[] = [];
    if (changeCounts.plan > 0) sections.push("Plan");
    if (changeCounts.revenue > 0) sections.push("Revenue");
    if (changeCounts.expenditure > 0) sections.push("Expenditure");

    // Reason for a hold / failure: commit error envelope wins, then a
    // quarantine reason, then the auto-commit-gate park reason.
    let reason: string | null = null;
    const err = asRecord(summary.error);
    const quarantine = asRecord(sched.quarantine);
    const gate = asRecord(sched.autoCommitGate);
    if (typeof err.message === "string") {
      reason = err.message;
    } else if (typeof quarantine.reason === "string") {
      const kind = quarantine.kind === "older_revision" ? "Older revision" : "Duplicate";
      reason = `${kind}: ${quarantine.reason}`;
    } else if (gate.decision === "park" && typeof gate.reason === "string") {
      reason = gate.reason;
    }

    return {
      runId: run.id,
      projectId: run.projectId ?? null,
      projectName: run.projectName ?? null,
      fileName: run.sourceFileName ?? null,
      status: String(run.status ?? ""),
      committedAt: run.committedAt ?? null,
      uploadedAt: run.uploadedAt ?? null,
      matchSource: typeof sched.matchSource === "string" ? (sched.matchSource as string) : null,
      sections,
      changeCounts,
      reason,
    };
  });

  const counts = files.reduce(
    (acc, f) => {
      acc.total++;
      const s = f.status.toLowerCase();
      if (s === "committed") acc.committed++;
      else if (s === "failed" || s === "rejected" || s === "rolled_back") acc.failed++;
      else if (s === "awaiting_review") acc.needsReview++;
      else acc.inProgress++; // 'preview' and any transient state
      return acc;
    },
    { total: 0, committed: 0, needsReview: 0, failed: 0, inProgress: 0 },
  );

  return {
    batchRunId: latestBatchId,
    // Scheduler stamps uploadedAt at row insert during the tick, so the newest
    // run's uploadedAt is when this pull ran.
    ranAt: batchRuns[0]?.uploadedAt ?? null,
    counts,
    files,
  };
}
