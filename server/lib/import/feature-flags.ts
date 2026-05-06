/**
 * Smart Import — feature flags and observability counters.
 *
 * Separated from commit-executor so the rollback toggle and the
 * structured per-import metrics can be configured / inspected without
 * touching the write-path logic.
 *
 * **USE_THREE_WAY_MERGE** — env-driven kill switch for the per-row
 * `import_snapshot` merge engine added in PR2C. When set to `false`,
 * commit-executor still computes `row_hash` and writes
 * `import_snapshot` (so re-enabling later is non-disruptive), but
 * skips the merge-engine call and the populated-but-not-yet-consumed
 * `mergeConflicts` channel. The existing `conflict-engine.ts` (which
 * uses `summaryJson` baseline and IS wired through the route's 409
 * envelope) continues to detect conflicts unchanged. This keeps prod
 * safe if a bug is discovered in the new engine post-deploy.
 *
 * Default: ON (the new engine runs). Turn off via:
 *   export USE_THREE_WAY_MERGE=false
 *
 * **ImportMetrics** — per-import counters captured by each section
 * writer and surfaced at the end of the commit transaction. Kept
 * intentionally lightweight: just numeric counters keyed by event,
 * no per-row payload. Routed to `console.info` in JSON for the
 * operator to grep / forward to a log aggregator.
 */

export function threeWayMergeEnabled(): boolean {
  const raw = process.env.USE_THREE_WAY_MERGE;
  if (raw === undefined || raw === "") return true; // default ON
  const norm = raw.trim().toLowerCase();
  return !(norm === "false" || norm === "0" || norm === "no" || norm === "off");
}

/**
 * **USE_SNAPSHOT_BASELINE** — when ON, the planner / 3-way conflict gate
 * builds its baseline (B) from the per-row `import_snapshot` JSONB on
 * each canonical table instead of `smartImportRuns.summaryJson.normalization`
 * from the last committed run.
 *
 * Why: the writer engine (merge-engine.ts) already uses `import_snapshot`
 * as its baseline. The planner using `summaryJson.normalization` meant
 * the two engines disagreed on B — the writer would surface "More
 * conflicts found" 409s for fields the planner had auto-resolved,
 * causing the user-visible loop reported on Mondi/Bree imports.
 *
 * Aligning both engines on the same per-row snapshot baseline closes
 * that gap. `import_snapshot` is also refreshed on every commit AND
 * every manual cell edit, so the baseline correctly reflects the last
 * "ground truth" the user saw — unlike the summaryJson baseline, which
 * is anchored to whatever file was last imported.
 *
 * Default: ON. Turn off via:
 *   export USE_SNAPSHOT_BASELINE=false
 */
export function snapshotBaselineEnabled(): boolean {
  const raw = process.env.USE_SNAPSHOT_BASELINE;
  if (raw === undefined || raw === "") return true; // default ON
  const norm = raw.trim().toLowerCase();
  return !(norm === "false" || norm === "0" || norm === "no" || norm === "off");
}

export interface ImportMetrics {
  importRunId: number;
  projectId: number;
  // Per-section counters
  plan: SectionMetrics;
  revenue: SectionMetrics;
  expenditure: SectionMetrics;
  // Auxiliary writers (PR2C)
  actuals: { inserted: number; orphaned: number };
  metadata: { written: boolean };
  summary: { written: boolean };
  // Engine usage
  threeWayMergeEnabled: boolean;
  durationMs: number;
}

export interface SectionMetrics {
  inserted: number;
  updated: number;
  unchanged: number;
  softClosed: number;
  conflictsSurfaced: number;
  rowHashesUpgraded: number; // legacy rows that picked up a hash on this import
}

export function emptySectionMetrics(): SectionMetrics {
  return {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    softClosed: 0,
    conflictsSurfaced: 0,
    rowHashesUpgraded: 0,
  };
}

export function newImportMetrics(importRunId: number, projectId: number): ImportMetrics {
  return {
    importRunId,
    projectId,
    plan: emptySectionMetrics(),
    revenue: emptySectionMetrics(),
    expenditure: emptySectionMetrics(),
    actuals: { inserted: 0, orphaned: 0 },
    metadata: { written: false },
    summary: { written: false },
    threeWayMergeEnabled: threeWayMergeEnabled(),
    durationMs: 0,
  };
}

/**
 * Emit a structured one-line summary of an import to the application
 * log. Designed to be greppable: every entry starts with
 * `[SmartImport.metrics]` so a log forwarder can pick them up reliably.
 *
 * Format intentionally avoids stack-style multi-line output so a
 * downstream JSON parser can consume one line per import.
 */
export function emitImportMetrics(m: ImportMetrics): void {
  // eslint-disable-next-line no-console
  console.info(`[SmartImport.metrics] ${JSON.stringify(m)}`);
}
