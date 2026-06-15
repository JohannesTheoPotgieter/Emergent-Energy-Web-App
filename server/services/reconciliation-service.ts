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
 * Per-project tracker-vs-QuickBooks was retired (QB cost bills aren't project-
 * tagged); company-level QB reconciliation lives in qb-tracker-reconcile.ts.
 */

import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";

import { financialReconciliation, fiscalPeriods } from "@shared/schema/finance";
import { projectInfo } from "@shared/schema/projects";
import { normalizedCostLineActuals } from "@shared/schema/finance";
import { qbReconIgnores, qbRevenueReconIgnores } from "@shared/schema/integrations";
import { db } from "../db";
import {
  FinanceLineLevelRepository,
  aggregateLinesByMonth,
  type FinanceLine,
  type FinanceLineBucket,
} from "../repositories/finance-line-level-repository";
import {
  resolvePeriodIdForDate,
  type FiscalPeriodRow,
} from "../scripts/backfill-fiscal-period";
import { getProfitAndLossReport } from "./quickbooks-service";
import { parsePnLCompanyTotals } from "./qb-pnl-totals";

/** Ties / drift tolerance (Rand). Matches the §3.3.2 R1 audit tolerance. */
export const RECON_R1 = 1;

export type ReconStatus = "green" | "amber" | "red" | "unlinked";
/** Portfolio-only display state for projects with no computed row yet. */
export type ReconDisplayStatus = ReconStatus | "unknown";

export type DbOrTx = typeof db;

/**
 * `derivationWarning` values split into two honest buckets:
 *
 *  - STRUCTURAL (red): genuine corruption — an actuals row with no parent, or a
 *    category whose net actuals are negative (credits > costs) so the §3.3
 *    per-line formula would invert sign. These are real reconciliation faults.
 *
 *  - UNLINKED (not red): the §3.3 "allocation missing / not yet derivable" line
 *    conditions — the cost line has no LIVE category_revenue_allocations row to
 *    look up (FK + (project, category_key) fallback both miss), or the category
 *    carries no revenue allocation / no actuals to divide by. Per §3.3 this is an
 *    "allocation missing" badge / data-readiness state (re-import to link the
 *    allocation), NOT a reconciliation failure. Surfacing it as red "Structural"
 *    is misleading — every project with one un-linked line reads as a corruption.
 */
const STRUCTURAL_WARNINGS = new Set<string>([
  "orphan_actuals_row_no_parent",
  "category_total_actual_negative",
]);
const UNLINKED_WARNINGS = new Set<string>([
  "missing_category_allocation_linkage",
  "category_revenue_allocation_missing",
  "category_total_actual_zero",
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
  /** Genuine corruption (orphan row / negative category) → red. */
  structuralLineIds: number[];
  /** §3.3 "allocation missing / not yet derivable" lines → unlinked (not red). */
  unlinkedLineIds: number[];
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
  const unlinkedLineIds: number[] = [];
  const drift: Array<{ id: number; abs: number }> = [];

  for (const l of lines) {
    appTotal += l.perLineRevenue;
    if (l.derivationWarning && STRUCTURAL_WARNINGS.has(l.derivationWarning)) {
      structuralLineIds.push(l.lineId);
    } else if (l.derivationWarning && UNLINKED_WARNINGS.has(l.derivationWarning)) {
      unlinkedLineIds.push(l.lineId);
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
    reason = `${structuralLineIds.length} structural issue${structuralLineIds.length === 1 ? "" : "s"} — an actuals row has no parent cost line, or a category's net actuals are negative (cannot derive revenue).`;
    offendingLineIds = structuralLineIds;
  } else if (unlinkedLineIds.length > 0) {
    // §3.3 "allocation missing": the line(s) have no LIVE category allocation to
    // derive revenue against. This is a data-readiness state (re-import to link),
    // NOT a reconciliation failure — surfaced honestly as "unlinked", never red.
    status = "unlinked";
    reason = `${unlinkedLineIds.length} line${unlinkedLineIds.length === 1 ? "" : "s"} not yet linked to a category allocation — re-import the project to derive revenue (§3.3 'allocation missing'). Revenue/GP for these lines is excluded until linked.`;
    offendingLineIds = unlinkedLineIds;
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
    unlinkedLineIds,
    driftLineIds,
    offendingLineIds,
    reason,
  };
}

const round2 = (n: number): number => Number(n.toFixed(2));

/** Worst-of rollup for the per-project board chip. Precedence:
 *  red (corruption) → unlinked (allocation missing) → amber (drift) → green. */
export function worstStatus(statuses: readonly ReconStatus[]): ReconDisplayStatus {
  if (statuses.length === 0) return "unknown";
  if (statuses.includes("red")) return "red";
  if (statuses.includes("unlinked")) return "unlinked";
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
  /**
   * True when the project has at least one pasted tracker cross-check value
   * (col-U `revenue_recognition_amount`) to reconcile against. A `green` status
   * means two very different things depending on this flag:
   *   - `true`  → the app genuinely TIES to the pasted tracker within R1.
   *   - `false` → there is NO tracker baseline pasted; the app is only
   *               internally consistent ("not compared yet"). Such a project
   *               must NOT be reported as a tie-to-tracker.
   * Derived at read time from the live actuals so it needs no schema change and
   * touches no frozen finance computation path.
   */
  trackerBaselinePresent: boolean;
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

  // Tracker-baseline presence: which projects have ANY pasted col-U cross-check
  // (`revenue_recognition_amount`) on a live actuals row. Lets the board tell a
  // genuine tie-to-tracker apart from "no tracker pasted yet" — both of which
  // otherwise compute to `green` with a zero delta. Read-only; mirrors the
  // active-row guard (effective_to IS NULL AND deleted_at IS NULL). No finance
  // figure is read or recomputed here.
  const baselineRows = (await dbi
    .select({ projectId: normalizedCostLineActuals.projectId })
    .from(normalizedCostLineActuals)
    .where(
      and(
        isNull(normalizedCostLineActuals.effectiveTo),
        isNull(normalizedCostLineActuals.deletedAt),
        isNotNull(normalizedCostLineActuals.revenueRecognitionAmount),
      ),
    )
    .groupBy(normalizedCostLineActuals.projectId)) as Array<{ projectId: number }>;
  const baselineSet = new Set(baselineRows.map((r) => r.projectId));

  const out: ReconPortfolioProject[] = projects.map((p) => {
    const periodRows = byProject.get(p.id) ?? [];
    const statuses = periodRows
      .map((r) => r.status)
      .filter((s): s is ReconStatus => s === "green" || s === "amber" || s === "red" || s === "unlinked");
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
      trackerBaselinePresent: baselineSet.has(p.id),
    };
  });

  // Worst first, so the board surfaces problems. red (corruption) → unlinked
  // (allocation missing) → amber (drift) → unknown → green, then by |delta|.
  const rank: Record<ReconDisplayStatus, number> = { red: 0, unlinked: 1, amber: 2, unknown: 3, green: 4 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.absDelta - a.absDelta);
  return out;
}

export interface ReconDetailLine {
  lineId: number;
  /** Parent cost line id — the key the COS line-review actions are keyed on. */
  costLineId: number;
  categoryName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  /** COS — the actual cost amount on this line (Excel col Q). */
  actualTotal: number;
  revenueDerived: number;
  revenueStored: number | null;
  reconDelta: number | null;
  /** Per-line GP = revenueDerived − actualTotal (§ 3.3). */
  perLineGp: number;
  /** Realised / committed / planned (§ 3.2 realisation gate). */
  bucket: FinanceLineBucket;
  /** Date-colour realisation signal — true = BLACK/confirmed (read),
   *  false/null = RED/defaulted (forecast). */
  invoiceDateConfirmed: boolean | null;
  invoiceDateFontColor: string | null;
  /** YYYY-MM recognition bucket + any human move-period override. */
  recognitionMonth: string | null;
  recognitionDateOverride: string | null;
  poNumber: string | null;
  /** Provenance — where the imported value came from. */
  sourceCell: string | null;
  sourceFileHash: string | null;
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

  // source_cell + source_file_hash provenance live on the persisted actuals
  // rows (migration 0092). Both surfaced so the project finance view can prove
  // every line back to its origin cell + file (D4).
  const lineIds = lines.map((l) => l.lineId).filter((id) => id > 0);
  const sourceCellById = new Map<number, string | null>();
  const sourceFileHashById = new Map<number, string | null>();
  if (lineIds.length > 0) {
    const cells = (await dbi
      .select({
        id: normalizedCostLineActuals.id,
        sourceCell: normalizedCostLineActuals.sourceCell,
        sourceFileHash: normalizedCostLineActuals.sourceFileHash,
      })
      .from(normalizedCostLineActuals)
      .where(inArray(normalizedCostLineActuals.id, lineIds))) as Array<{
      id: number;
      sourceCell: string | null;
      sourceFileHash: string | null;
    }>;
    for (const c of cells) {
      sourceCellById.set(c.id, c.sourceCell);
      sourceFileHashById.set(c.id, c.sourceFileHash);
    }
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
      costLineId: l.parentLineId,
      categoryName: l.categoryName,
      description: l.descriptionOfWork,
      invoiceNumber: l.invoiceNumber,
      invoiceRaisedDate: l.invoiceRaisedDate,
      actualTotal: round2(l.actualTotal),
      revenueDerived: round2(l.perLineRevenue),
      revenueStored: l.revenueStored != null ? round2(l.revenueStored) : null,
      reconDelta: l.reconDelta != null ? round2(l.reconDelta) : null,
      perLineGp: round2(l.perLineGp),
      bucket: l.bucket,
      invoiceDateConfirmed: l.invoiceDateConfirmed,
      invoiceDateFontColor: l.invoiceDateFontColor,
      recognitionMonth: l.recognitionMonth,
      recognitionDateOverride: l.recognitionDateOverride,
      poNumber: l.poNumber,
      sourceCell: sourceCellById.get(l.lineId) ?? null,
      sourceFileHash: sourceFileHashById.get(l.lineId) ?? null,
      derivationWarning: l.derivationWarning,
      offending: offending.has(l.lineId),
    }))
    .sort((a, b) => {
      if (a.offending !== b.offending) return a.offending ? -1 : 1;
      return Math.abs(b.reconDelta ?? 0) - Math.abs(a.reconDelta ?? 0);
    });

  const reconIgnores = await getProjectReconIgnores(dbi, proj?.projectName ?? null);

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
    reconIgnores,
  };
}

// ---------------------------------------------------------------------------
// COMPANY-LEVEL tracker-vs-QuickBooks (Revenue / COS / GP)
//
// QB cost bills are not project-tagged, so COS/GP only reconcile to QuickBooks
// at the COMPANY level. This compares the app's canonical §3.3 company totals
// (Σ perLineRevenue / Σ COS / Σ GP, via the single read path) against
// QuickBooks' own P&L Revenue / COS / GP for the same window. Read-only — the
// app COMPARES and flags; it never adjusts a tracker (§ 3.4).
// ---------------------------------------------------------------------------

/** Company tie/drift tolerance (Rand). Same R1 tie tolerance used elsewhere. */
export const COMPANY_QB_TOLERANCE = RECON_R1;

export type CompanyQbMetric = "revenue" | "cos" | "gp";

export interface CompanyMetricComparison {
  metric: CompanyQbMetric;
  /** App canonical §3.3 total for the window. */
  tracker: number;
  /** QuickBooks P&L total, or null when QB is unavailable / omits the section. */
  qb: number | null;
  /** tracker − qb (0 when qb is null). Signed: positive ⇒ app reports more. */
  delta: number;
  /** green = ties within tolerance, amber = drift, unknown = no QB figure. */
  status: ReconDisplayStatus;
}

export interface CompanyTrackerVsQb {
  generatedAt: string;
  fyLabel: string;
  qbAvailable: boolean;
  revenue: CompanyMetricComparison;
  cos: CompanyMetricComparison;
  gp: CompanyMetricComparison;
  /** green (all tie) · amber (any drift) · unknown (no QB data at all). */
  overallStatus: ReconDisplayStatus;
}

/** PURE: classify one company metric (tracker vs QB) into ties / drift / unknown. */
export function classifyCompanyMetric(
  metric: CompanyQbMetric,
  trackerTotal: number,
  qbTotal: number | null,
  tolerance: number = COMPANY_QB_TOLERANCE,
): CompanyMetricComparison {
  const tracker = round2(trackerTotal);
  if (qbTotal == null) {
    return { metric, tracker, qb: null, delta: 0, status: "unknown" };
  }
  const qb = round2(qbTotal);
  const delta = round2(tracker - qb);
  return { metric, tracker, qb, delta, status: Math.abs(delta) <= tolerance ? "green" : "amber" };
}

/** PURE: roll the three metric statuses into the headline company status. */
export function rollupCompanyStatus(
  statuses: readonly ReconDisplayStatus[],
): ReconDisplayStatus {
  if (statuses.includes("amber")) return "amber";
  if (statuses.every((s) => s === "unknown")) return "unknown";
  return "green";
}

export async function getCompanyTrackerVsQb(
  dbi: DbOrTx,
  opts: { fyStart?: string; fyEnd?: string; fyLabel?: string } = {},
): Promise<CompanyTrackerVsQb> {
  // App canonical company totals via the single §3.3 read path.
  const projects = (await dbi
    .select({ id: projectInfo.id })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))) as Array<{ id: number }>;
  const projectIds = projects.map((p) => p.id);
  const repo = new FinanceLineLevelRepository(dbi);
  const lines = projectIds.length
    ? await repo.getPortfolioFinanceLines(projectIds, { fyStart: opts.fyStart, fyEnd: opts.fyEnd })
    : [];
  const total = aggregateLinesByMonth(lines).total;
  const tracker = { revenue: total.revenue, cos: total.cos, gp: total.gp };

  // QuickBooks P&L company totals (best-effort — null when QB unavailable).
  let qb: { revenue: number | null; cos: number | null; gp: number | null } | null = null;
  try {
    const report = await getProfitAndLossReport(
      opts.fyStart ?? "2000-01-01",
      opts.fyEnd ?? "2100-12-31",
    );
    qb = parsePnLCompanyTotals(report);
  } catch (err) {
    console.warn(
      "[reconciliation] company QB P&L unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    qb = null;
  }

  const revenue = classifyCompanyMetric("revenue", tracker.revenue, qb?.revenue ?? null);
  const cos = classifyCompanyMetric("cos", tracker.cos, qb?.cos ?? null);
  const gp = classifyCompanyMetric("gp", tracker.gp, qb?.gp ?? null);

  return {
    generatedAt: new Date().toISOString(),
    fyLabel: opts.fyLabel ?? "",
    qbAvailable: qb != null && (qb.revenue != null || qb.cos != null || qb.gp != null),
    revenue,
    cos,
    gp,
    overallStatus: rollupCompanyStatus([revenue.status, cos.status, gp.status]),
  };
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
