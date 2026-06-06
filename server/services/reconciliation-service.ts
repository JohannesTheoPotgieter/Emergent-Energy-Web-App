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
import { qbReconIgnores, qbRevenueReconIgnores } from "@shared/schema/integrations";
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
  /** Tracker-vs-QuickBooks (P2.3), rolled up across the project's periods. */
  qbStatus: ReconDisplayStatus;
  /** Σ tracker_vs_qb_delta (signed unreconciled QB gap). */
  qbDelta: number;
  /** Σ |tracker_vs_qb_delta| — headline QB gap magnitude. */
  qbAbsDelta: number;
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
      qbStatus: financialReconciliation.trackerVsQbStatus,
      qbDelta: financialReconciliation.trackerVsQbDelta,
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
    qbStatus: string | null;
    qbDelta: string | null;
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
    let qbSigned = 0;
    let qbAbs = 0;
    let computedAt: Date | null = null;
    for (const r of periodRows) {
      const d = r.delta != null ? Number(r.delta) : 0;
      if (Number.isFinite(d)) {
        signed += d;
        abs += Math.abs(d);
      }
      const qd = r.qbDelta != null ? Number(r.qbDelta) : 0;
      if (Number.isFinite(qd)) {
        qbSigned += qd;
        qbAbs += Math.abs(qd);
      }
      if (r.computedAt && (!computedAt || r.computedAt > computedAt)) computedAt = r.computedAt;
    }
    const qbStatuses = periodRows
      .map((r) => r.qbStatus)
      .filter((s): s is ReconStatus => s === "green" || s === "amber" || s === "red");
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
      qbStatus: worstStatus(qbStatuses),
      qbDelta: round2(qbSigned),
      qbAbsDelta: round2(qbAbs),
    };
  });

  // Worst first across BOTH dimensions (red, amber, then by combined abs delta),
  // so the board surfaces problems regardless of which comparison flagged them.
  const rank: Record<ReconDisplayStatus, number> = { red: 0, amber: 1, unknown: 2, green: 3 };
  const worstOf = (p: ReconPortfolioProject) => Math.min(rank[p.status], rank[p.qbStatus]);
  out.sort(
    (a, b) => worstOf(a) - worstOf(b) || b.absDelta + b.qbAbsDelta - (a.absDelta + a.qbAbsDelta),
  );
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
  /** Tracker-vs-QuickBooks (P2.3), rolled up across the project's periods. */
  trackerVsQbStatus: ReconDisplayStatus;
  trackerVsQbDelta: number;
  /** Suppressed QB variances — shown, never silently dropped. */
  reconIgnores: ReconIgnoreView[];
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

  const reconIgnores = await getProjectReconIgnores(dbi, proj?.projectName ?? null);
  const qb = await getTrackerVsQbForProject(dbi, projectId);

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
    trackerVsQbStatus: qb.status,
    trackerVsQbDelta: qb.delta,
    reconIgnores,
  };
}

// ---------------------------------------------------------------------------
// P2.3 — tracker vs QuickBooks
//
// The app COMPARES the tracker to QuickBooks and FLAGS mismatches; it NEVER
// auto-adjusts the tracker (owner rule — trackers stay the source of truth).
// The per-project signal is the QB reconciliation GAP: QuickBooks bills/invoices
// resolved to a project that are NOT reconciled (matched/linked) to the tracker,
// EXCLUDING active recon-ignores (which are surfaced separately, with reason).
// ---------------------------------------------------------------------------

export interface TrackerVsQbResult {
  status: ReconStatus;
  /** The unreconciled QB gap (signed; same units as the trackers). */
  delta: number;
  reason: string;
}

/**
 * PURE: classify a project×period QB gap. green = reconciles within R1; amber =
 * an unreconciled gap exists (drift); red = structural — unmapped QB entries
 * that can't even be attributed to the tracker. Never adjusts a figure.
 */
export function computeTrackerVsQbStatus(
  gapDelta: number,
  unmappedCount = 0,
): TrackerVsQbResult {
  const abs = Math.abs(gapDelta);
  if (unmappedCount > 0) {
    return {
      status: "red",
      delta: round2(gapDelta),
      reason: `${unmappedCount} QuickBooks entr${unmappedCount === 1 ? "y" : "ies"} could not be attributed to the tracker (R${abs.toFixed(2)} unreconciled).`,
    };
  }
  if (abs > RECON_R1) {
    return {
      status: "amber",
      delta: round2(gapDelta),
      reason: `R${abs.toFixed(2)} of QuickBooks activity is not reconciled to the tracker.`,
    };
  }
  return {
    status: "green",
    delta: round2(gapDelta),
    reason: "Tracker reconciles to QuickBooks within R1.",
  };
}

/** Per (project, period) QB gap, consumed from the existing QB comparison. */
export interface TrackerVsQbGap {
  fiscalPeriodId: number;
  /** Σ unreconciled QB amount resolved to the project in the period (non-ignored). */
  gapDelta: number;
  /** QB entries resolved to a project but with no usable mapping (red). */
  unmappedCount?: number;
}

/**
 * Write tracker_vs_qb_status / tracker_vs_qb_delta onto the active
 * financial_reconciliation row for each (project, period), consuming the QB gap.
 * Updates the QB columns IN PLACE on the active row (annotation metadata — it
 * does not touch app_vs_tracker history); inserts a row when none exists yet.
 * Never adjusts a tracker figure.
 */
export async function refreshTrackerVsQbForProjects(
  dbi: DbOrTx,
  gapsByProject: ReadonlyMap<number, readonly TrackerVsQbGap[]>,
): Promise<{ rowsWritten: number }> {
  const now = new Date();
  let rowsWritten = 0;
  for (const [projectId, gaps] of gapsByProject) {
    for (const g of gaps) {
      const res = computeTrackerVsQbStatus(g.gapDelta, g.unmappedCount ?? 0);
      const [active] = await dbi
        .select({ id: financialReconciliation.id })
        .from(financialReconciliation)
        .where(
          and(
            eq(financialReconciliation.projectId, projectId),
            eq(financialReconciliation.fiscalPeriodId, g.fiscalPeriodId),
            isNull(financialReconciliation.effectiveTo),
          ),
        )
        .limit(1);

      if (active != null) {
        await dbi
          .update(financialReconciliation)
          .set({
            trackerVsQbStatus: res.status,
            trackerVsQbDelta: res.delta.toFixed(2),
            computedAt: now,
          })
          .where(
            and(
              eq(financialReconciliation.id, active.id),
              isNull(financialReconciliation.effectiveTo),
            ),
          );
      } else {
        await dbi.insert(financialReconciliation).values({
          projectId,
          fiscalPeriodId: g.fiscalPeriodId,
          appVsTrackerStatus: null,
          appVsTrackerDelta: null,
          trackerVsQbStatus: res.status,
          trackerVsQbDelta: res.delta.toFixed(2),
          computedAt: now,
          notes: res.reason,
          effectiveFrom: now,
          effectiveTo: null,
        });
      }
      rowsWritten += 1;
    }
  }
  return { rowsWritten };
}

/** Roll up a project's persisted tracker_vs_qb across its active periods. */
async function getTrackerVsQbForProject(
  dbi: DbOrTx,
  projectId: number,
): Promise<{ status: ReconDisplayStatus; delta: number }> {
  const rows = (await dbi
    .select({
      status: financialReconciliation.trackerVsQbStatus,
      delta: financialReconciliation.trackerVsQbDelta,
    })
    .from(financialReconciliation)
    .where(
      and(
        eq(financialReconciliation.projectId, projectId),
        isNull(financialReconciliation.effectiveTo),
      ),
    )) as Array<{ status: string | null; delta: string | null }>;

  const statuses = rows
    .map((r) => r.status)
    .filter((s): s is ReconStatus => s === "green" || s === "amber" || s === "red");
  let signed = 0;
  for (const r of rows) {
    const d = r.delta != null ? Number(r.delta) : 0;
    if (Number.isFinite(d)) signed += d;
  }
  return { status: worstStatus(statuses), delta: round2(signed) };
}

/** A suppressed QB variance, surfaced (never silently dropped). */
export interface ReconIgnoreView {
  side: "cost" | "revenue";
  qbEntityId: string;
  qbDocNumber: string | null;
  counterpartyName: string | null;
  amountExVat: number | null;
  reason: string;
  ignoredByName: string | null;
  ignoredAt: string | null;
}

/**
 * Active recon-ignores for a project (both cost + revenue sides), so a
 * suppressed variance shows as "ignored by {user}, {reason}, {date}" rather
 * than being silently dropped. Matched on the resolver's project name.
 */
export async function getProjectReconIgnores(
  dbi: DbOrTx,
  projectName: string | null,
): Promise<ReconIgnoreView[]> {
  if (!projectName) return [];

  const cost = (await dbi
    .select({
      qbBillId: qbReconIgnores.qbBillId,
      qbDocNumber: qbReconIgnores.qbDocNumber,
      vendorName: qbReconIgnores.vendorName,
      lineAmountExVat: qbReconIgnores.lineAmountExVat,
      reason: qbReconIgnores.reason,
      ignoredByName: qbReconIgnores.ignoredByName,
      ignoredAt: qbReconIgnores.ignoredAt,
    })
    .from(qbReconIgnores)
    .where(
      and(
        eq(qbReconIgnores.resolvedProjectName, projectName),
        isNull(qbReconIgnores.deletedAt),
      ),
    )) as Array<{
    qbBillId: string;
    qbDocNumber: string | null;
    vendorName: string | null;
    lineAmountExVat: string | null;
    reason: string;
    ignoredByName: string | null;
    ignoredAt: Date | null;
  }>;

  const revenue = (await dbi
    .select({
      qbInvoiceId: qbRevenueReconIgnores.qbInvoiceId,
      qbDocNumber: qbRevenueReconIgnores.qbDocNumber,
      customerName: qbRevenueReconIgnores.customerName,
      lineAmountExVat: qbRevenueReconIgnores.lineAmountExVat,
      reason: qbRevenueReconIgnores.reason,
      ignoredByName: qbRevenueReconIgnores.ignoredByName,
      ignoredAt: qbRevenueReconIgnores.ignoredAt,
    })
    .from(qbRevenueReconIgnores)
    .where(
      and(
        eq(qbRevenueReconIgnores.resolvedProjectName, projectName),
        isNull(qbRevenueReconIgnores.deletedAt),
      ),
    )) as Array<{
    qbInvoiceId: string;
    qbDocNumber: string | null;
    customerName: string | null;
    lineAmountExVat: string | null;
    reason: string;
    ignoredByName: string | null;
    ignoredAt: Date | null;
  }>;

  const out: ReconIgnoreView[] = [];
  for (const c of cost) {
    out.push({
      side: "cost",
      qbEntityId: c.qbBillId,
      qbDocNumber: c.qbDocNumber,
      counterpartyName: c.vendorName,
      amountExVat: c.lineAmountExVat != null ? Number(c.lineAmountExVat) : null,
      reason: c.reason,
      ignoredByName: c.ignoredByName,
      ignoredAt: c.ignoredAt ? c.ignoredAt.toISOString() : null,
    });
  }
  for (const r of revenue) {
    out.push({
      side: "revenue",
      qbEntityId: r.qbInvoiceId,
      qbDocNumber: r.qbDocNumber,
      counterpartyName: r.customerName,
      amountExVat: r.lineAmountExVat != null ? Number(r.lineAmountExVat) : null,
      reason: r.reason,
      ignoredByName: r.ignoredByName,
      ignoredAt: r.ignoredAt ? r.ignoredAt.toISOString() : null,
    });
  }
  return out;
}
