/**
 * Smart Import review service — backs the parked-run review screen.
 *
 *  - `previewReconciliationForRun` returns the reconciliation the project WOULD
 *    have after committing the run, computed by a rolled-back dry-run commit
 *    (scheduler-commit `dryRun`). It reuses the exact §3.3 engine and the P2.2
 *    reconciliation service; it persists nothing and changes no number.
 *  - `rejectSmartImportRun` dismisses a parked run (status → `rejected`),
 *    writes an `audit_events` row, and leaves the source file and every figure
 *    untouched. A committed run is NOT rejectable (use rollback instead).
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { smartImportRuns } from "@shared/schema";
import { commitSmartImportRunAsSystem } from "./scheduler-commit";
import type { ReconProjectDetail } from "./reconciliation-service";
import { logAudit } from "../audit-logger";

export interface ReconciliationPreviewResult {
  runId: number;
  projectId: number | null;
  /** Post-commit reconciliation (rolled-back dry-run). Null when the run has no
   *  matched project, or the dry-run could not apply the import. */
  recon: ReconProjectDetail | null;
  /** Import-quality signals lifted from the run's stored normalization. */
  importQuality: ImportQualitySignals;
  note: string | null;
}

export interface ImportQualitySignals {
  /** Cost/revenue date cells read from cell colour (the §3.7 realisation signal). */
  colourReadDates: number;
  /** Date cells that fell back to a default (colour fidelity not available). */
  defaultedDates: number;
  /** Invoice dates derived from a payment date rather than read directly. */
  paymentDerivedInvoiceDates: number;
  /** Category allocations whose revenue-allocation (col J/V) is missing. */
  categoriesMissingAllocation: number;
}

function extractImportQuality(summary: unknown): ImportQualitySignals {
  const s = (summary ?? {}) as Record<string, any>;
  const norm = (s.normalization ?? {}) as Record<string, any>;
  const q = (norm.qualitySignals ?? norm.dateQuality ?? {}) as Record<string, any>;
  const allocs: Array<{ revenueAllocation?: unknown }> = Array.isArray(norm.categoryAllocations)
    ? norm.categoryAllocations
    : [];
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    colourReadDates: num(q.colourReadDates ?? q.colourRead),
    defaultedDates: num(q.defaultedDates ?? q.defaulted),
    paymentDerivedInvoiceDates: num(q.paymentDerivedInvoiceDates ?? q.paymentDerivedDates),
    categoriesMissingAllocation: allocs.filter((a) => a.revenueAllocation == null).length,
  };
}

export async function previewReconciliationForRun(
  runId: number,
): Promise<ReconciliationPreviewResult> {
  const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
  if (!run) {
    throw Object.assign(new Error("Import run not found"), { status: 404, code: "run_not_found" });
  }

  const importQuality = extractImportQuality(run.summaryJson);

  if (!run.projectId) {
    return {
      runId,
      projectId: null,
      recon: null,
      importQuality,
      note: "No project matched yet — assign a project to preview reconciliation.",
    };
  }

  const result = await commitSmartImportRunAsSystem({ runId, dryRun: true });
  if (result.status === "dry_run_preview") {
    return { runId, projectId: run.projectId, recon: result.recon, importQuality, note: null };
  }
  // Any other status means the dry-run could not apply (no normalization,
  // recency, blocking conflicts, …). The recon stays null with a note.
  return {
    runId,
    projectId: run.projectId,
    recon: null,
    importQuality,
    note: `Preview unavailable (${result.status}).`,
  };
}

export interface RejectRunParams {
  runId: number;
  userId: number | null;
  userName: string | null;
  role: string | null;
  reason: string;
}

export interface RejectRunResult {
  status: "rejected" | "not_rejectable";
  runId: number;
  previousStatus?: string;
}

/**
 * Dismiss a parked run. Only `awaiting_review` / `preview` runs are rejectable;
 * a committed run must be rolled back (rejecting it would orphan applied data).
 * The update is status-guarded so a racing commit is never clobbered.
 */
export async function rejectSmartImportRun(params: RejectRunParams): Promise<RejectRunResult> {
  const { runId, userId, userName, role, reason } = params;

  const [run] = await db.select().from(smartImportRuns).where(eq(smartImportRuns.id, runId));
  if (!run) {
    throw Object.assign(new Error("Import run not found"), { status: 404, code: "run_not_found" });
  }
  if (run.status !== "awaiting_review" && run.status !== "preview") {
    return { status: "not_rejectable", runId, previousStatus: run.status };
  }

  const prevSummary = (run.summaryJson ?? {}) as Record<string, unknown>;
  const updated = await db
    .update(smartImportRuns)
    .set({
      status: "rejected",
      summaryJson: {
        ...prevSummary,
        rejected: {
          reason,
          byUserId: userId,
          byName: userName,
          at: new Date().toISOString(),
        },
      },
    })
    .where(
      and(
        eq(smartImportRuns.id, runId),
        inArray(smartImportRuns.status, ["awaiting_review", "preview"]),
      ),
    )
    .returning({ id: smartImportRuns.id });

  if (updated.length === 0) {
    const [now] = await db
      .select({ status: smartImportRuns.status })
      .from(smartImportRuns)
      .where(eq(smartImportRuns.id, runId));
    return { status: "not_rejectable", runId, previousStatus: now?.status };
  }

  // Audit — the source file and every reported figure are untouched; we only
  // dismissed the staged run.
  try {
    await logAudit({
      userId: userId ?? undefined,
      userName: userName ?? undefined,
      actorRole: role ?? undefined,
      entityType: "smart_import",
      entityId: String(runId),
      action: "reject",
      projectName: run.projectName ?? undefined,
      source: "IMPORT",
      changesJson: {
        reason,
        previousStatus: run.status,
        sourceFileName: run.sourceFileName,
      },
    });
  } catch (auditErr) {
    console.warn(
      "[SmartImportReview] reject audit write failed (non-blocking):",
      auditErr instanceof Error ? auditErr.message : auditErr,
    );
  }

  return { status: "rejected", runId, previousStatus: run.status };
}
