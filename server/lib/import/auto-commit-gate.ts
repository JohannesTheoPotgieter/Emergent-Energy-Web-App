/**
 * Auto-commit gate for the SharePoint scheduled importer.
 *
 * Tightens the definition of "clean" for UNATTENDED auto-commit. A run only
 * auto-commits when it is provably clean; anything else PARKS as
 * `awaiting_review` with a reason (the operator reviews and commits
 * deliberately). This adds NO prompt to the clean path (owner policy #1012) —
 * it only moves not-provably-clean runs off the auto-commit path.
 *
 * The decision is a pure function fed cheap, pre-computed signals so it is
 * unit-testable without a database. The one signal that needs the DB — the
 * locked-period check — is resolved by the caller (via the existing
 * `enforceCosPeriodLock`) and passed in as `lockedPeriods`.
 *
 * Nothing here changes a calculation or a reported number; it only routes a
 * run to commit vs. review.
 */

import { normalizeAllocationConfidence } from "./utils";

/** A run auto-commits only if at most this fraction of existing live rows
 *  would soft-close. Above it, a wipe is likely (sheet truncated, wrong file)
 *  → park for a human. */
export const OVER_WIPE_THRESHOLD = 0.8;

/** A run auto-commits only if NO project's REV or COS would swing more than
 *  this percent vs. its current value. A bigger swing (mass re-date, wrong
 *  file, a sheet edited beyond a routine refresh) parks for a human. The
 *  default is conservative; the scheduler may pass a project-tuned override. */
export const NET_DELTA_PARK_THRESHOLD_PCT = 25;

export interface AutoCommitGateSignals {
  /** Unresolved BLOCKER issues in the preview/normalization. */
  hasBlockers: boolean;
  /** Locked fiscal period(s) any row in the commit touches (YYYY-MM-01). */
  lockedPeriods: string[];
  /** Tracker revenue-allocation header was broken (J4 = "ERROR on REV"). */
  errorOnRev: boolean;
  /** New/changed cost lines exist while a category allocation is missing. */
  missingAllocationOnNewLines: boolean;
  /** Fraction (0..1) of existing live rows that would soft-close this commit. */
  softClosePct: number;
  /** Planner found rows the operator previously deleted reappearing. */
  hasResurrections: boolean;
  /** The existing scheduler conflict policy decided to park. */
  conflictPolicyParks: boolean;
  /**
   * A project's REV or COS would swing beyond the configured net-delta
   * threshold vs. its current value. Optional — defaults to no swing so
   * existing callers are unaffected. Compute with `detectNetDeltaExceeded`.
   */
  deltaExceeded?: boolean;
  /** The project / metric / signed-percent that tripped `deltaExceeded`. */
  deltaExceededDetail?: NetDeltaDetail | null;
}

export interface AutoCommitDecision {
  decision: "commit" | "park";
  /** Operator-facing reason shown on the review screen when parked. */
  reason: string;
}

/**
 * Decide whether a scheduled run is provably clean enough to auto-commit.
 * Order is worst-first so the surfaced reason is the most material one.
 */
export function decideSchedulerAutoCommit(s: AutoCommitGateSignals): AutoCommitDecision {
  if (s.lockedPeriods.length > 0) {
    return { decision: "park", reason: `locked period ${[...s.lockedPeriods].sort().join(", ")}` };
  }
  if (s.hasBlockers) {
    return { decision: "park", reason: "unresolved blocker issues" };
  }
  if (s.errorOnRev) {
    return { decision: "park", reason: 'tracker revenue allocation error ("ERROR on REV")' };
  }
  if (s.missingAllocationOnNewLines) {
    return { decision: "park", reason: "missing category allocation on new cost lines" };
  }
  if (s.softClosePct > OVER_WIPE_THRESHOLD) {
    return {
      decision: "park",
      reason: `over-wipe: ${Math.round(s.softClosePct * 100)}% of existing rows would close`,
    };
  }
  if (s.deltaExceeded) {
    const d = s.deltaExceededDetail;
    return {
      decision: "park",
      reason: d
        ? `net delta: ${d.projectName} ${d.metric} swings ${d.pct > 0 ? "+" : ""}${Math.round(d.pct)}% vs current`
        : "net delta exceeds threshold",
    };
  }
  if (s.hasResurrections) {
    return { decision: "park", reason: "previously-deleted rows would be restored" };
  }
  if (s.conflictPolicyParks) {
    return { decision: "park", reason: "conflicts need review" };
  }
  return { decision: "commit", reason: "clean" };
}

// ---------------------------------------------------------------------------
// Pure signal extractors (no DB) — keep the scheduler thin + testable.
// ---------------------------------------------------------------------------

interface SectionCountsLike {
  newCount?: number;
  changedCount?: number;
  missingFromUploadCount?: number;
  existingRowCount?: number;
}
interface PlannerLike {
  sections?: {
    PLAN?: SectionCountsLike | null;
    REVENUE?: SectionCountsLike | null;
    EXPENDITURE?: SectionCountsLike | null;
  };
  resurrections?: unknown[] | null;
}
interface CategoryAllocationLike {
  revenueAllocation?: number | string | null;
  allocationSource?: string | null;
  allocationConfidence?: string | null;
}

const SECTIONS = ["PLAN", "REVENUE", "EXPENDITURE"] as const;

/** Σ missingFromUploadCount / Σ existingRowCount across sections (0 when no
 *  existing rows, e.g. a baseline import). */
export function computeSoftClosePct(planner: PlannerLike | null | undefined): number {
  if (!planner?.sections) return 0;
  let missing = 0;
  let existing = 0;
  for (const key of SECTIONS) {
    const sec = planner.sections[key];
    if (!sec) continue;
    missing += sec.missingFromUploadCount ?? 0;
    existing += sec.existingRowCount ?? 0;
  }
  return existing > 0 ? missing / existing : 0;
}

/** New + changed EXPENDITURE rows — "is there cost-line activity this import?" */
export function expenditureChurn(planner: PlannerLike | null | undefined): number {
  const sec = planner?.sections?.EXPENDITURE;
  if (!sec) return 0;
  return (sec.newCount ?? 0) + (sec.changedCount ?? 0);
}

/** True when the tracker's revenue-allocation header was broken and recovered
 *  by positional fallback ("ERROR on REV") — trusted for a human, but parked
 *  for unattended auto-commit. */
export function detectErrorOnRev(allocs: CategoryAllocationLike[] | null | undefined): boolean {
  if (!Array.isArray(allocs)) return false;
  return allocs.some(
    (a) =>
      normalizeAllocationConfidence(a.allocationConfidence ?? a.allocationSource) ===
      "header_error_positional",
  );
}

/** True when there is cost-line activity AND a category allocation is missing
 *  its revenue allocation (the §3.3 "allocation missing" case) — new lines
 *  would land on an underivable category. */
export function detectMissingAllocationOnNewLines(
  planner: PlannerLike | null | undefined,
  allocs: CategoryAllocationLike[] | null | undefined,
): boolean {
  if (expenditureChurn(planner) <= 0) return false;
  if (!Array.isArray(allocs)) return false;
  return allocs.some((a) => a.revenueAllocation == null);
}

/** Every periodised effective date a commit would touch, for the locked-period
 *  check — mirrors the HTTP commit's `commitLockDates` (smart-import-routes.ts).
 *  Pure: returns the dates; the caller runs `enforceCosPeriodLock`. */
export function collectCommitLockDates(norm: unknown): Array<string | null | undefined> {
  const n = (norm ?? {}) as {
    costLines?: Array<{ invoiceDate?: string | null }>;
    actualLineRows?: Array<{ invoiceDate?: string | null }>;
    revenueLines?: Array<{ invoiceDate?: string | null; paidDate?: string | null }>;
  };
  const dates: Array<string | null | undefined> = [];
  for (const cl of n.costLines ?? []) dates.push(cl?.invoiceDate);
  for (const a of n.actualLineRows ?? []) dates.push(a?.invoiceDate);
  for (const rl of n.revenueLines ?? []) {
    dates.push(rl?.invoiceDate);
    dates.push(rl?.paidDate);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Net-delta guard — park when a project's REV or COS swings beyond a threshold
// vs. its current value (mass re-date / wrong file / a sheet edited beyond a
// routine refresh). Pure: the caller supplies the per-project current-vs-next
// REV/COS totals (the next-totals come from the parsed run; the current totals
// are read through the canonical finance read path) and this decides.
// ---------------------------------------------------------------------------

export interface NetDeltaDetail {
  projectName: string;
  metric: "REV" | "COS";
  /** Signed percent swing of the run's value vs. the current value. */
  pct: number;
}

export interface ProjectMetricSwing {
  projectName: string;
  metric: "REV" | "COS";
  /** Current (pre-commit) value for the project + metric. */
  current: number;
  /** Value this run would produce for the project + metric. */
  next: number;
}

/**
 * Signed percent swing of `next` vs. `current`.
 *  - both 0            → 0 (no swing).
 *  - current 0, next≠0 → +Infinity (a metric appearing from nothing is a
 *    structural change → always over any finite threshold → park).
 *  - otherwise         → (next − current) / |current| × 100.
 */
export function computeMetricSwingPct(current: number, next: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(next)) return Number.POSITIVE_INFINITY;
  if (current === 0) return next === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((next - current) / Math.abs(current)) * 100;
}

/**
 * Decide the net-delta signal: does any project's REV or COS swing beyond
 * `thresholdPct` (absolute)? Returns the WORST (largest absolute) swing as the
 * surfaced detail. Empty / missing input → not exceeded (a baseline import with
 * no prior totals does not trip this; the over-wipe guard covers wipes).
 */
export function detectNetDeltaExceeded(
  swings: ProjectMetricSwing[] | null | undefined,
  thresholdPct: number = NET_DELTA_PARK_THRESHOLD_PCT,
): { exceeded: boolean; detail: NetDeltaDetail | null } {
  if (!Array.isArray(swings) || swings.length === 0) return { exceeded: false, detail: null };
  let worst: NetDeltaDetail | null = null;
  for (const s of swings) {
    const pct = computeMetricSwingPct(s.current, s.next);
    if (Math.abs(pct) > thresholdPct) {
      if (!worst || Math.abs(pct) > Math.abs(worst.pct)) {
        worst = { projectName: s.projectName, metric: s.metric, pct };
      }
    }
  }
  return worst ? { exceeded: true, detail: worst } : { exceeded: false, detail: null };
}
