/**
 * Smart Import v2 — Baseline Detection & Current State Loading
 *
 * Determines whether an import is BASELINE or INCREMENTAL, and loads
 * the current active rows from the database for comparison.
 */

import { db } from "../../db";
import {
  smartImportRuns,
  normalizedCostLines,
  normalizedRevenueLines,
  workItems,
} from "@shared/schema";
import { eq, and, desc, isNull, isNotNull, or } from "drizzle-orm";
import type { NormalizationResult } from "./normalizer";
import { snapshotBaselineEnabled } from "./feature-flags";

export type ImportMode = "BASELINE" | "INCREMENTAL";

export interface BaselineInfo {
  importMode: ImportMode;
  /** The ID of the last committed import run (null for BASELINE) */
  lastCommittedRunId: number | null;
  /** When the last import was committed (null for BASELINE) */
  lastCommittedAt: Date | null;
}

/**
 * Determine whether a project's next import should be BASELINE or INCREMENTAL.
 * BASELINE = no prior COMMITTED import exists for this projectId.
 * INCREMENTAL = at least one prior COMMITTED import exists.
 */
export async function detectImportMode(projectId: number): Promise<BaselineInfo> {
  const [lastCommitted] = await db
    .select({
      id: smartImportRuns.id,
      committedAt: smartImportRuns.committedAt,
    })
    .from(smartImportRuns)
    .where(
      and(
        eq(smartImportRuns.projectId, projectId),
        eq(smartImportRuns.status, "committed"),
      ),
    )
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);

  if (!lastCommitted) {
    return {
      importMode: "BASELINE",
      lastCommittedRunId: null,
      lastCommittedAt: null,
    };
  }

  return {
    importMode: "INCREMENTAL",
    lastCommittedRunId: lastCommitted.id,
    lastCommittedAt: lastCommitted.committedAt,
  };
}

// ---------------------------------------------------------------------------
// Current state loaders — fetch active rows (effectiveTo IS NULL)
// ---------------------------------------------------------------------------

/**
 * Load current active PLAN rows (work_items where source=SMART_IMPORT, workstream=PM)
 * for a given project.
 */
export async function loadCurrentPlanRows(projectId: number) {
  return db
    .select({
      id: workItems.id,
      taskName: workItems.title,
      taskNo: workItems.wbsCode,
      phase: workItems.phase,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      durationDays: workItems.duration,
      actualStartDate: workItems.actualStart,
      actualEndDate: workItems.actualEnd,
      actualDurationDays: workItems.actualDuration,
      owner: workItems.ownerName,
      status: workItems.status,
      pctComplete: workItems.percentComplete,
      expectedPctComplete: workItems.expectedPctComplete,
      comment: workItems.description,
      isMilestone: workItems.isMilestone,
      parentTaskNo: workItems.outlineNumber,
      subProjectName: workItems.subProjectName,
      // Faithful-mirror compare fields (2026-05-29) — must be loaded so the
      // matcher compares the file value against the stored value (not undefined).
      lead: workItems.lead,
      resource1: workItems.resource1,
      resource2: workItems.resource2,
      trackerComments: workItems.trackerComments,
      workDays: workItems.workDays,
      importRunId: workItems.importRunId,
      externalRef: workItems.externalRef,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.source, "SMART_IMPORT"),
        eq(workItems.workstream, "PM"),
        isNull(workItems.deletedAt),
      ),
    );
}

/**
 * Load current active REVENUE rows for a given project.
 * Only rows where effectiveTo IS NULL (current version).
 */
export async function loadCurrentRevenueRows(projectId: number) {
  return db
    .select({
      id: normalizedRevenueLines.id,
      milestoneName: normalizedRevenueLines.milestoneName,
      milestoneNo: normalizedRevenueLines.milestoneNo,
      milestonePercent: normalizedRevenueLines.milestonePercent,
      description: normalizedRevenueLines.description,
      amountExVat: normalizedRevenueLines.amountExVat,
      vat: normalizedRevenueLines.vat,
      invoiceNumber: normalizedRevenueLines.invoiceNumber,
      invoiceDate: normalizedRevenueLines.invoiceDate,
      expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
      paidDate: normalizedRevenueLines.paidDate,
      inBankDate: normalizedRevenueLines.inBankDate,
      status: normalizedRevenueLines.status,
      subProjectName: normalizedRevenueLines.subProjectName,
      // Faithful-mirror compare field (2026-05-29) — must be loaded so the
      // matcher compares the file value against the stored value (not undefined).
      milestoneNotes: normalizedRevenueLines.milestoneNotes,
      importRunId: normalizedRevenueLines.importRunId,
    })
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.projectId, projectId),
        and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)),
      ),
    );
}

/**
 * Load current active EXPENDITURE rows for a given project.
 * Only rows where effectiveTo IS NULL (current version).
 */
export async function loadCurrentCostRows(projectId: number) {
  return db
    .select({
      id: normalizedCostLines.id,
      costCategory: normalizedCostLines.costCategory,
      counterpartyName: normalizedCostLines.counterpartyName,
      description: normalizedCostLines.description,
      amountExVat: normalizedCostLines.amountExVat,
      budgetQty: normalizedCostLines.budgetQty,
      budgetRate: normalizedCostLines.budgetRate,
      budgetTotal: normalizedCostLines.budgetTotal,
      budgetCos: normalizedCostLines.budgetCos,
      invoiceNumber: normalizedCostLines.invoiceNumber,
      invoiceDate: normalizedCostLines.invoiceDate,
      approvedDate: normalizedCostLines.approvedDate,
      paidDate: normalizedCostLines.paidDate,
      forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
      poNumber: normalizedCostLines.poNumber,
      status: normalizedCostLines.status,
      subProjectName: normalizedCostLines.subProjectName,
      revenueRecognitionAmount: normalizedCostLines.revenueRecognitionAmount,
      // Faithful-mirror compare fields (2026-05-29) — must be loaded so the
      // matcher compares the file value against the stored value (not undefined).
      comments: normalizedCostLines.comments,
      checkFlag: normalizedCostLines.checkFlag,
      savingOverrun: normalizedCostLines.savingOverrun,
      usdExchangeRate: normalizedCostLines.usdExchangeRate,
      pricePerWatt: normalizedCostLines.pricePerWatt,
      importRunId: normalizedCostLines.importRunId,
    })
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)),
      ),
    );
}

// ---------------------------------------------------------------------------
// Soft-deleted row loaders — fetch rows that the operator has removed in the
// app since the last import. These are NOT used for matching active rows
// (which would re-pull them as if they were live), but the planner cross-
// references them against the file's NEW rows so a re-import that brings
// back a row the operator explicitly deleted surfaces as an explicit
// "resurrection" decision rather than silently re-inserting a duplicate.
//
// Cost / revenue lines: soft-delete signal is `effectiveTo IS NOT NULL`
//   (temporal closure) OR `deletedAt IS NOT NULL` (hard soft-delete).
//   Both forms are emitted from the legacy DELETE routes.
// Work items: soft-delete signal is `deletedAt IS NOT NULL` only — the
//   temporal columns don't exist on work_items.
// ---------------------------------------------------------------------------

export interface DeletedRowSummary<TRow = Record<string, unknown>> {
  id: number;
  deletedAt: Date | null;
  effectiveTo: Date | null;
  row: TRow;
}

/**
 * Load soft-deleted PLAN rows (work_items) for a given project.
 * Returns the most-recently-deleted row when the same business key has
 * been soft-deleted more than once — the operator's latest intent wins.
 */
export async function loadDeletedPlanRows(projectId: number): Promise<Array<DeletedRowSummary>> {
  const rows = await db
    .select({
      id: workItems.id,
      deletedAt: workItems.deletedAt,
      taskName: workItems.title,
      taskNo: workItems.wbsCode,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      actualStartDate: workItems.actualStart,
      actualEndDate: workItems.actualEnd,
      owner: workItems.ownerName,
      status: workItems.status,
      pctComplete: workItems.percentComplete,
      subProjectName: workItems.subProjectName,
      externalRef: workItems.externalRef,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.source, "SMART_IMPORT"),
        eq(workItems.workstream, "PM"),
        isNotNull(workItems.deletedAt),
      ),
    )
    .orderBy(desc(workItems.deletedAt));

  return rows.map((r: any) => ({
    id: r.id,
    deletedAt: r.deletedAt,
    effectiveTo: null,
    row: r,
  }));
}

/**
 * Load soft-deleted REVENUE rows for a given project.
 * A revenue line is treated as deleted when EITHER deletedAt OR
 * effectiveTo is set — operators delete via the active-row UI which
 * closes the temporal version (effectiveTo) without setting deletedAt.
 */
export async function loadDeletedRevenueRows(projectId: number): Promise<Array<DeletedRowSummary>> {
  const rows = await db
    .select({
      id: normalizedRevenueLines.id,
      deletedAt: normalizedRevenueLines.deletedAt,
      effectiveTo: normalizedRevenueLines.effectiveTo,
      milestoneName: normalizedRevenueLines.milestoneName,
      milestoneNo: normalizedRevenueLines.milestoneNo,
      milestonePercent: normalizedRevenueLines.milestonePercent,
      description: normalizedRevenueLines.description,
      amountExVat: normalizedRevenueLines.amountExVat,
      vat: normalizedRevenueLines.vat,
      invoiceNumber: normalizedRevenueLines.invoiceNumber,
      invoiceDate: normalizedRevenueLines.invoiceDate,
      expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
      paidDate: normalizedRevenueLines.paidDate,
      inBankDate: normalizedRevenueLines.inBankDate,
      status: normalizedRevenueLines.status,
      subProjectName: normalizedRevenueLines.subProjectName,
      importRunId: normalizedRevenueLines.importRunId,
    })
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.projectId, projectId),
        or(
          isNotNull(normalizedRevenueLines.deletedAt),
          isNotNull(normalizedRevenueLines.effectiveTo),
        ),
      ),
    );

  return rows.map((r: any) => ({
    id: r.id,
    deletedAt: r.deletedAt,
    effectiveTo: r.effectiveTo,
    row: r,
  }));
}

/**
 * Load soft-deleted EXPENDITURE rows for a given project.
 * Mirrors loadDeletedRevenueRows.
 */
export async function loadDeletedCostRows(projectId: number): Promise<Array<DeletedRowSummary>> {
  const rows = await db
    .select({
      id: normalizedCostLines.id,
      deletedAt: normalizedCostLines.deletedAt,
      effectiveTo: normalizedCostLines.effectiveTo,
      costCategory: normalizedCostLines.costCategory,
      counterpartyName: normalizedCostLines.counterpartyName,
      description: normalizedCostLines.description,
      amountExVat: normalizedCostLines.amountExVat,
      budgetQty: normalizedCostLines.budgetQty,
      budgetRate: normalizedCostLines.budgetRate,
      budgetTotal: normalizedCostLines.budgetTotal,
      budgetCos: normalizedCostLines.budgetCos,
      invoiceNumber: normalizedCostLines.invoiceNumber,
      invoiceDate: normalizedCostLines.invoiceDate,
      approvedDate: normalizedCostLines.approvedDate,
      paidDate: normalizedCostLines.paidDate,
      forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
      poNumber: normalizedCostLines.poNumber,
      status: normalizedCostLines.status,
      subProjectName: normalizedCostLines.subProjectName,
      revenueRecognitionAmount: normalizedCostLines.revenueRecognitionAmount,
      importRunId: normalizedCostLines.importRunId,
    })
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        or(
          isNotNull(normalizedCostLines.deletedAt),
          isNotNull(normalizedCostLines.effectiveTo),
        ),
      ),
    );

  return rows.map((r: any) => ({
    id: r.id,
    deletedAt: r.deletedAt,
    effectiveTo: r.effectiveTo,
    row: r,
  }));
}

// ---------------------------------------------------------------------------
// Baseline snapshot loader — last committed import's normalization data
// ---------------------------------------------------------------------------

/**
 * Load the normalization data from the last COMMITTED import run for a project.
 * This serves as the "baseline" (B) in the 3-way merge: B vs C vs F.
 *
 * Returns null if no committed run exists (baseline import).
 */
export async function loadBaselineNormalization(
  projectId: number,
): Promise<NormalizationResult | null> {
  const [lastCommitted] = await db
    .select({
      id: smartImportRuns.id,
      summaryJson: smartImportRuns.summaryJson,
    })
    .from(smartImportRuns)
    .where(
      and(
        eq(smartImportRuns.projectId, projectId),
        eq(smartImportRuns.status, "committed"),
      ),
    )
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);

  if (!lastCommitted) return null;

  const summary = lastCommitted.summaryJson as any;
  if (!summary?.normalization) return null;

  return summary.normalization as NormalizationResult;
}

// ---------------------------------------------------------------------------
// Per-row snapshot baseline — aligns planner with writer engine
// ---------------------------------------------------------------------------

/**
 * Build the 3-way merge baseline (B) from each canonical table's per-row
 * `import_snapshot` JSONB instead of `summaryJson.normalization`.
 *
 * Why this exists: the writer engine (`merge-engine.ts`) uses
 * `import_snapshot` as its baseline. The planner / pre-commit gate
 * (`conflict-engine.ts`) historically used `summaryJson.normalization`
 * from the last committed run. Those two baselines drift apart because
 * the snapshot is refreshed on every commit AND every manual cell edit,
 * while `summaryJson.normalization` is only ever written when the run
 * is created.
 *
 * The mismatch produces the user-visible "More conflicts found — data
 * changed while you were resolving" loop: the planner clears the user's
 * resolutions, the writer reclassifies using its own snapshot baseline
 * and re-throws 409 with a different conflict set, and the cycle
 * repeats. Aligning both engines on the same per-row snapshot is the
 * fix.
 *
 * The returned shape is `NormalizationResult`-compatible (only
 * `planTasks`, `revenueLines`, `costLines` are populated) so the
 * existing `runConflictEngine(... baselineNormalization, ...)` consumer
 * sees no change at the call boundary.
 *
 * Snapshot-key → normalizer-field mapping is required for PLAN because
 * the snapshot uses work_items column names (`duration`, `actualStart`,
 * `ownerName`, `percentComplete`, `description`, `outlineNumber`)
 * whereas `PLAN_COMPARE_FIELDS` uses normalizer names (`durationDays`,
 * `actualStartDate`, `owner`, `pctComplete`, `comment`, `parentTaskNo`).
 * REVENUE and EXPENDITURE snapshots already use compare-field naming.
 */
export async function loadBaselineFromSnapshots(
  projectId: number,
): Promise<NormalizationResult | null> {
  // Load the live current state for each section AND the per-row
  // `importSnapshot` JSONB. Live rows already come back with normalizer
  // field naming (the existing `loadCurrent*Rows` helpers do that
  // mapping for PLAN), so they double as the per-row fallback when the
  // snapshot is null/empty — exactly mirroring the writer engine's
  // `const snapSource = importSnapshot ?? existingRow` behaviour
  // (merge-engine.ts:154). That keeps legacy / pre-PR2C-backfill rows
  // from poisoning the baseline with `undefined` tracked fields.
  const [
    planLive, revenueLive, costLive,
    planSnapRows, revenueSnapRows, costSnapRows,
  ] = await Promise.all([
    loadCurrentPlanRows(projectId),
    loadCurrentRevenueRows(projectId),
    loadCurrentCostRows(projectId),
    db.select({ id: workItems.id, importSnapshot: workItems.importSnapshot })
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        eq(workItems.source, "SMART_IMPORT"),
        eq(workItems.workstream, "PM"),
        isNull(workItems.deletedAt),
      )),
    db.select({ id: normalizedRevenueLines.id, importSnapshot: normalizedRevenueLines.importSnapshot })
      .from(normalizedRevenueLines)
      .where(and(
        eq(normalizedRevenueLines.projectId, projectId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      )),
    db.select({ id: normalizedCostLines.id, importSnapshot: normalizedCostLines.importSnapshot })
      .from(normalizedCostLines)
      .where(and(
        eq(normalizedCostLines.projectId, projectId),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      )),
  ]);

  // No active rows at all → no snapshot baseline to build. Caller will
  // typically fall back to `loadBaselineNormalization`.
  if (planLive.length === 0 && revenueLive.length === 0 && costLive.length === 0) {
    return null;
  }

  const snapById = (rows: ReadonlyArray<{ id: number; importSnapshot: unknown }>) => {
    const m = new Map<number, Record<string, unknown>>();
    for (const r of rows) {
      const raw = r.importSnapshot;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        m.set(r.id, raw as Record<string, unknown>);
      }
    }
    return m;
  };
  const planSnapById = snapById(planSnapRows);
  const revenueSnapById = snapById(revenueSnapRows);
  const costSnapById = snapById(costSnapRows);

  // Map snapshot keys (work_items column names) → normalizer field
  // names for PLAN. The snapshot is the merge-engine's per-row B; the
  // conflict engine compares it against `PLAN_COMPARE_FIELDS` which
  // uses the normalizer naming, so we project here. Pass-through keys
  // (startDate, endDate, status, expectedPctComplete, isMilestone,
  // lead, resource1, resource2, trackerComments, workDays) keep their
  // names via the `?? k` fallback below.
  const PLAN_SNAPSHOT_TO_NORM: Record<string, string> = {
    duration: "durationDays",
    actualStart: "actualStartDate",
    actualEnd: "actualEndDate",
    actualDuration: "actualDurationDays",
    ownerName: "owner",
    percentComplete: "pctComplete",
    description: "comment",
    outlineNumber: "parentTaskNo",
  };

  // For each live row, start from the live (normalizer-shaped) row as
  // the per-row fallback baseline, then overlay the snapshot values
  // (mapped where needed). Snapshot wins over live where present;
  // missing snapshot keys leave the live value as the baseline. This
  // matches `merge-engine.ts:154` (`importSnapshot ?? existingRow`).
  // Skip null/undefined snapshot values in the overlay. A snapshot
  // explicitly stores `null` for any tracked field that was empty in
  // the workbook at last import (see `buildSnapshot` in
  // commit-executor.ts) — but treating that null as "the baseline value
  // really was empty" is wrong. Many production rows carry snapshots
  // recorded by older imports whose tracked-field set was smaller, so
  // newly-tracked fields appear as explicit-null in the snapshot even
  // though the file at the time DID populate them. Overwriting the
  // live value with that null collapses the baseline to "empty" and
  // produces hundreds of phantom 3-way conflicts (the user then sees
  // BASELINE: empty / YOUR EDIT: <real value> / SOURCE: <file value>
  // for fields they never edited). Falling back to the live value at
  // the field level — instead of the row level — matches the writer
  // engine's intent (`importSnapshot ?? existingRow` at merge-engine.ts
  // :154) and keeps the planner and writer aligned so the conflict
  // count doesn't bounce when the executor re-checks.
  const planTasks = planLive.map((r: typeof planLive[number]) => {
    const out: Record<string, any> = { ...r };
    const snap = planSnapById.get(r.id);
    if (snap) {
      for (const [k, v] of Object.entries(snap)) {
        if (v === null || v === undefined) continue;
        const normKey = PLAN_SNAPSHOT_TO_NORM[k] ?? k;
        out[normKey] = v;
      }
    }
    return out;
  });

  const revenueLines = revenueLive.map((r: typeof revenueLive[number]) => {
    const out: Record<string, any> = { ...r };
    const snap = revenueSnapById.get(r.id);
    if (snap) {
      for (const [k, v] of Object.entries(snap)) {
        if (v === null || v === undefined) continue;
        out[k] = v;
      }
    }
    return out;
  });

  const costLines = costLive.map((r: typeof costLive[number]) => {
    const out: Record<string, any> = { ...r };
    const snap = costSnapById.get(r.id);
    if (snap) {
      for (const [k, v] of Object.entries(snap)) {
        if (v === null || v === undefined) continue;
        out[k] = v;
      }
    }
    return out;
  });

  return {
    planTasks,
    revenueLines,
    costLines,
    // The conflict engine never reads these fields off the baseline —
    // they're only on the type. Cast keeps the structural-typing happy
    // without forcing us to fabricate phase metadata, issues, etc.
  } as unknown as NormalizationResult;
}

/**
 * Unified baseline loader honouring the `USE_SNAPSHOT_BASELINE` flag.
 *
 * Returns the per-row snapshot baseline when the flag is ON (default)
 * and falls back to `loadBaselineNormalization` (the legacy
 * `summaryJson.normalization` source) when the flag is OFF or the
 * snapshot loader returns null because no active rows exist yet.
 */
export async function loadBaselineForPlanner(
  projectId: number,
): Promise<NormalizationResult | null> {
  if (snapshotBaselineEnabled()) {
    const fromSnap = await loadBaselineFromSnapshots(projectId);
    if (fromSnap) return fromSnap;
  }
  return loadBaselineNormalization(projectId);
}
