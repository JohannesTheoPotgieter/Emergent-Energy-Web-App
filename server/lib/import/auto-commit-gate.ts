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
