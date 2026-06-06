/**
 * Reconciliation service (P2.2) — per project × fiscal period app-vs-tracker status.
 *
 * READ-ONLY computation. Alters no finance calculation: it consumes the § 3.3.2
 * single read path (finance-line-level-repository) and the P2.1 persisted
 * provenance (revenue_derived / revenue_stored / recon_delta) and writes a
 * derived STATUS into `financial_reconciliation` (snapshot-guarded, effective_to).
 *
 * Status (app vs the project's tracker — the pasted Excel col-U cross-check):
 *   green  — the app's § 3.3 formula totals tie to the tracker within R1.
 *   amber  — drift: the pasted col-U has drifted from the formula
 *            (accumulated |recon_delta| > R1 — a stale paste).
 *   red    — structural: a line cannot be reconciled at all — missing category
 *            allocation, an orphan actuals row with no parent/allocation, or a
 *            broken tracker revenue allocation (the workbook's "ERROR on REV"
 *            J-cell surfaces here as a missing/zero allocation). These are the
 *            repository's `derivationWarning`s.
 *
 * tracker_vs_qb_* columns are out of scope for P2.2 and left null.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { financialReconciliation, fiscalPeriods } from "@shared/schema/finance";
import { projectInfo } from "@shared/schema/projects";
import { normalizedCostLineActuals } from "@shared/schema/finance";
import { db } from "../db";
import {
  FinanceLineLevelRepository,
  type FinanceLine,
} from "../repositories/finance-line-level-repository";
import {
  resolvePeriodIdForDate,
  type FiscalPeriodRow,
} from "../scripts/backfill-fiscal-period";

/** Ties / drift tolerance (Rand). Matches the §3.3.2 R1 audit tolerance. */
export const RECON_R1 = 1;

export type ReconStatus = "green" | "amber" | "red";
/** Portfolio-only display state for projects with no computed row yet. */
export type ReconDisplayStatus = ReconStatus | "unknown";

export type DbOrTx = typeof db;

/** `derivationWarning` values that mean the line cannot be revenue-derived at
 *  all → structural (red). Mirrors finance-line-level-repository's warnings. */
const STRUCTURAL_WARNINGS = new Set<string>([
  "orphan_actuals_row_no_parent",
  "missing_category_allocation_linkage",
  "category_revenue_allocation_missing",
  "category_total_actual_zero",
  "category_total_actual_negative",
]);

/** Minimal per-line shape the status maths need. Decoupled from FinanceLine so
 *  the computation is pure + unit-testable without the repository. */
export interface ReconLineInput {
  lineId: number;
  /** App (reported) per-line revenue — the § 3.3 formula. */
  perLineRevenue: number;
  /** Tracker per-line value — the pasted Excel col-U. Null when not pasted. */
  revenueStored: number | null;
  /** revenueStored − perLineRevenue (P2.1). Null when no stored value. */
  reconDelta: number | null;
  /** Structural derivation warning (or null when the line derives cleanly). */
  derivationWarning: string | null;
}

export interface ReconStatusResult {
  status: ReconStatus;
  /** Σ perLineRevenue (app, all lines). */
  appTotal: number;
  /** Σ revenueStored (tracker, lines with a pasted col-U only). */
  trackerTotal: number;
  /** app − tracker over comparable (stored) lines = −Σ reconDelta. Signed:
   *  positive ⇒ the app reports MORE than the tracker pasted. */
  appVsTrackerDelta: number;
  /** Σ |reconDelta| — the accumulated drift between paste and formula. */
  accumulatedAbsDelta: number;
  structuralLineIds: number[];
  driftLineIds: number[];
  /** Lines to surface in the drawer, worst-first (structural, then drift). */
  offendingLineIds: number[];
  reason: string;
}

/**
 * PURE: classify a set of lines (one project × fiscal period) as green/amber/red.
 * Exported for unit testing the seeded-drift acceptance without a database.
 */
export function computeAppVsTrackerStatus(
  lines: readonly ReconLineInput[],
): ReconStatusResult {
  let appTotal = 0;
  let trackerTotal = 0;
  let accumulatedAbsDelta = 0;
  let signedDelta = 0; // Σ (perLineRevenue − revenueStored) over stored lines
  const structuralLineIds: number[] = [];
  const drift: Array<{ id: number; abs: number }> = [];

  for (const l of lines) {
    appTotal += l.perLineRevenue;
    if (l.derivationWarning && STRUCTURAL_WARNINGS.has(l.derivationWarning)) {
      structuralLineIds.push(l.lineId);
    }
    if (l.reconDelta != null) {
      const stored = l.revenueStored ?? 0;
      trackerTotal += stored;
      signedDelta += l.perLineRevenue - stored; // = −reconDelta
      const abs = Math.abs(l.reconDelta);
      accumulatedAbsDelta += abs;
      if (abs > RECON_R1) drift.push({ id: l.lineId, abs });
    }
  }

  const driftLineIds = drift
    .sort((a, b) => b.abs - a.abs)
    .map((d) => d.id);

  let status: ReconStatus;
  let reason: string;
  let offendingLineIds: number[];

  if (structuralLineIds.length > 0) {
    status = "red";
    reason = `${structuralLineIds.length} structural issue${structuralLineIds.length === 1 ? "" : "s"} — missing or invalid category allocation (cannot derive revenue).`;
    offendingLineIds = structuralLineIds;
  } else if (accumulatedAbsDelta > RECON_R1) {
    status = "amber";
    reason = `Pasted tracker value drifts from the §3.3 formula by R${accumulatedAbsDelta.toFixed(2)} across ${driftLineIds.length} line${driftLineIds.length === 1 ? "" : "s"} (stale paste).`;
    offendingLineIds = driftLineIds;
  } else {
    status = "green";
    reason =
      trackerTotal === 0 && accumulatedAbsDelta === 0
        ? "No tracker cross-check pasted; the app reports the §3.3 formula."
        : "App ties to the tracker within R1.";
    offendingLineIds = [];
  }

  return {
    status,
    appTotal: round2(appTotal),
    trackerTotal: round2(trackerTotal),
    appVsTrackerDelta: round2(signedDelta),
    accumulatedAbsDelta: round2(accumulatedAbsDelta),
    structuralLineIds,
    driftLineIds,
    offendingLineIds,
    reason,
  };
}

const round2 = (n: number): number => Number(n.toFixed(2));

/** Worst-of rollup for the per-project board chip. */
export function worstStatus(statuses: readonly ReconStatus[]): ReconDisplayStatus {
  if (statuses.length === 0) return "unknown";
  if (statuses.includes("red")) return "red";
  if (statuses.includes("amber")) return "amber";
  return "green";
}

const toReconLine = (l: FinanceLine): ReconLineInput => ({
  lineId: l.lineId,
  perLineRevenue: l.perLineRevenue,
  revenueStored: l.revenueStored,
  reconDelta: l.reconDelta,
  derivationWarning: l.derivationWarning,
});

// ---------------------------------------------------------------------------
// Refresh — write/refresh financial_reconciliation (snapshot-guarded)
// ---------------------------------------------------------------------------

export interface ReconRefreshSummary {
  projectsScanned: number;
  rowsWritten: number;
  rowsUnchanged: number;
}

/**
 * Recompute the app-vs-tracker status for the given projects (all active
 * projects when `projectIds` is null) and persist into financial_reconciliation,
 * one active row per (project, fiscal period), snapshot-guarded.
 *
 * Only re-snapshots when the (status, delta) of a (project, period) actually
 * changed — an unchanged recompute is a no-op, so the temporal history stays
 * meaningful. Called after each smart-import commit and on demand.
 */
export async function refreshReconciliationForProjects(
  dbi: DbOrTx,
  projectIds: number[] | null,
): Promise<ReconRefreshSummary> {
  const repo = new FinanceLineLevelRepository(dbi);

  const targetIds = projectIds
    ? [...new Set(projectIds.filter((id) => Number.isInteger(id) && id > 0))]
    : (
        await dbi
          .select({ id: projectInfo.id })
          .from(projectInfo)
          .where(isNull(projectInfo.deletedAt))
      ).map((r: { id: number }) => r.id);

  if (targetIds.length === 0) {
    return { projectsScanned: 0, rowsWritten: 0, rowsUnchanged: 0 };
  }

  const periods = (await dbi
    .select({
      id: fiscalPeriods.id,
      startDate: fiscalPeriods.startDate,
      endDate: fiscalPeriods.endDate,
    })
    .from(fiscalPeriods)) as FiscalPeriodRow[];

  const now = new Date();
  let rowsWritten = 0;
  let rowsUnchanged = 0;

  for (const projectId of targetIds) {
    const lines = await repo.getProjectFinanceLines(projectId);

    // Group lines by the fiscal period containing the recognition date (col T).
    const byPeriod = new Map<number, ReconLineInput[]>();
    for (const l of lines) {
      const periodId = resolvePeriodIdForDate(l.invoiceRaisedDate, periods);
      if (periodId == null) continue; // no calendar / no recognition date → not period-bucketed
      const arr = byPeriod.get(periodId) ?? [];
      arr.push(toReconLine(l));
      byPeriod.set(periodId, arr);
    }

    for (const [fiscalPeriodId, periodLines] of byPeriod) {
      const result = computeAppVsTrackerStatus(periodLines);

      // Current active row for this (project, period).
      const [active] = await dbi
        .select({
          id: financialReconciliation.id,
          status: financialReconciliation.appVsTrackerStatus,
          delta: financialReconciliation.appVsTrackerDelta,
        })
        .from(financialReconciliation)
        .where(
          and(
            eq(financialReconciliation.projectId, projectId),
            eq(financialReconciliation.fiscalPeriodId, fiscalPeriodId),
            isNull(financialReconciliation.effectiveTo),
          ),
        )
        .limit(1);

      const newDelta = result.appVsTrackerDelta.toFixed(2);
      const unchanged =
        active != null &&
        active.status === result.status &&
        active.delta != null &&
        Number(active.delta).toFixed(2) === newDelta;

      if (unchanged) {
        rowsUnchanged += 1;
        continue;
      }

      // Soft-close the previous active row, then insert the refreshed one.
      if (active != null) {
        await dbi
          .update(financialReconciliation)
          .set({ effectiveTo: now })
          .where(
            and(
              eq(financialReconciliation.id, active.id),
              isNull(financialReconciliation.effectiveTo),
            ),
          );
      }

      await dbi.insert(financialReconciliation).values({
        projectId,
        fiscalPeriodId,
        appVsTrackerStatus: result.status,
        appVsTrackerDelta: newDelta,
        trackerVsQbStatus: null,
        trackerVsQbDelta: null,
        computedAt: now,
        notes: result.reason,
        effectiveFrom: now,
        effectiveTo: null,
      });
      rowsWritten += 1;
    }
  }

  return { projectsScanned: targetIds.length, rowsWritten, rowsUnchanged };
}

// ---------------------------------------------------------------------------
// Read — portfolio summary + project detail
// ---------------------------------------------------------------------------

export interface ReconPortfolioProject {
  projectId: number;
  projectName: string;
  status: ReconDisplayStatus;
  /** Σ app_vs_tracker_delta across the project's periods (signed, app − tracker). */
  appVsTrackerDelta: number;
  /** Σ |app_vs_tracker_delta| — the headline drift magnitude. */
  absDelta: number;
  periodCount: number;
  amberPeriods: number;
  redPeriods: number;
  computedAt: string | null;
}

/**
 * Portfolio board: every ACTIVE project (so the board renders for all of them),
 * left-joined to its active financial_reconciliation rows, rolled up per project.
 */
export async function getReconciliationPortfolio(
  dbi: DbOrTx,
): Promise<ReconPortfolioProject[]> {
  const projects = (await dbi
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))) as Array<{ id: number; projectName: string }>;

  if (projects.length === 0) return [];

  const rows = (await dbi
    .select({
      projectId: financialReconciliation.projectId,
      status: financialReconciliation.appVsTrackerStatus,
      delta: financialReconciliation.appVsTrackerDelta,
      computedAt: financialReconciliation.computedAt,
    })
    .from(financialReconciliation)
    .where(
      and(
        isNull(financialReconciliation.effectiveTo),
        inArray(
          financialReconciliation.projectId,
          projects.map((p) => p.id),
        ),
      ),
    )) as Array<{
    projectId: number;
    status: string | null;
    delta: string | null;
    computedAt: Date | null;
  }>;

  const byProject = new Map<number, typeof rows>();
  for (const r of rows) {
    const arr = byProject.get(r.projectId) ?? [];
    arr.push(r);
    byProject.set(r.projectId, arr);
  }

  const out: ReconPortfolioProject[] = projects.map((p) => {
    const periodRows = byProject.get(p.id) ?? [];
    const statuses = periodRows
      .map((r) => r.status)
      .filter((s): s is ReconStatus => s === "green" || s === "amber" || s === "red");
    const status = worstStatus(statuses);
    let signed = 0;
    let abs = 0;
    let computedAt: Date | null = null;
    for (const r of periodRows) {
      const d = r.delta != null ? Number(r.delta) : 0;
      if (Number.isFinite(d)) {
        signed += d;
        abs += Math.abs(d);
      }
      if (r.computedAt && (!computedAt || r.computedAt > computedAt)) computedAt = r.computedAt;
    }
    return {
      projectId: p.id,
      projectName: p.projectName,
      status,
      appVsTrackerDelta: round2(signed),
      absDelta: round2(abs),
      periodCount: periodRows.length,
      amberPeriods: periodRows.filter((r) => r.status === "amber").length,
      redPeriods: periodRows.filter((r) => r.status === "red").length,
      computedAt: computedAt ? computedAt.toISOString() : null,
    };
  });

  // Worst first (red, amber, then by abs delta), so the board surfaces problems.
  const rank: Record<ReconDisplayStatus, number> = { red: 0, amber: 1, unknown: 2, green: 3 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.absDelta - a.absDelta);
  return out;
}

export interface ReconDetailLine {
  lineId: number;
  categoryName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  revenueDerived: number;
  revenueStored: number | null;
  reconDelta: number | null;
  sourceCell: string | null;
  derivationWarning: string | null;
  /** True when this line is the reason the project is amber/red. */
  offending: boolean;
}

export interface ReconProjectDetail {
  projectId: number;
  projectName: string | null;
  status: ReconStatus;
  appTotal: number;
  trackerTotal: number;
  appVsTrackerDelta: number;
  accumulatedAbsDelta: number;
  reason: string;
  lines: ReconDetailLine[];
}

/**
 * Project detail: the contributing lines with revenue_derived / revenue_stored /
 * recon_delta + source_cell, and which lines are offending. The drawer drills to
 * the offending line(s).
 */
export async function getReconciliationDetail(
  dbi: DbOrTx,
  projectId: number,
): Promise<ReconProjectDetail> {
  const repo = new FinanceLineLevelRepository(dbi);
  const lines = await repo.getProjectFinanceLines(projectId);
  const result = computeAppVsTrackerStatus(lines.map(toReconLine));
  const offending = new Set(result.offendingLineIds);

  // source_cell provenance lives on the persisted actuals rows (migration 0092).
  const lineIds = lines.map((l) => l.lineId).filter((id) => id > 0);
  const sourceCellById = new Map<number, string | null>();
  if (lineIds.length > 0) {
    const cells = (await dbi
      .select({ id: normalizedCostLineActuals.id, sourceCell: normalizedCostLineActuals.sourceCell })
      .from(normalizedCostLineActuals)
      .where(inArray(normalizedCostLineActuals.id, lineIds))) as Array<{
      id: number;
      sourceCell: string | null;
    }>;
    for (const c of cells) sourceCellById.set(c.id, c.sourceCell);
  }

  const [proj] = (await dbi
    .select({ projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(eq(projectInfo.id, projectId))
    .limit(1)) as Array<{ projectName: string | null }>;

  // Offending lines first, then by |reconDelta| desc, so the drawer lands on the
  // worst line.
  const detailLines: ReconDetailLine[] = lines
    .map((l) => ({
      lineId: l.lineId,
      categoryName: l.categoryName,
      description: l.descriptionOfWork,
      invoiceNumber: l.invoiceNumber,
      invoiceRaisedDate: l.invoiceRaisedDate,
      revenueDerived: round2(l.perLineRevenue),
      revenueStored: l.revenueStored != null ? round2(l.revenueStored) : null,
      reconDelta: l.reconDelta != null ? round2(l.reconDelta) : null,
      sourceCell: sourceCellById.get(l.lineId) ?? null,
      derivationWarning: l.derivationWarning,
      offending: offending.has(l.lineId),
    }))
    .sort((a, b) => {
      if (a.offending !== b.offending) return a.offending ? -1 : 1;
      return Math.abs(b.reconDelta ?? 0) - Math.abs(a.reconDelta ?? 0);
    });

  return {
    projectId,
    projectName: proj?.projectName ?? null,
    status: result.status,
    appTotal: result.appTotal,
    trackerTotal: result.trackerTotal,
    appVsTrackerDelta: result.appVsTrackerDelta,
    accumulatedAbsDelta: result.accumulatedAbsDelta,
    reason: result.reason,
    lines: detailLines,
  };
}
