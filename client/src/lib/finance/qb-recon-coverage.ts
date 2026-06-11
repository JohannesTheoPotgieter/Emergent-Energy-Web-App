/**
 * Pure match-coverage logic for the company tracker-vs-QuickBooks month table.
 *
 * Coverage = matched ex-VAT value ÷ total tracker-invoiced ex-VAT value, per the
 * owner's definition. It is DERIVED from the engine's already-persisted summary
 * fields (matchedTotal / trackerTotal) — no new amount calc, no number change.
 *
 * A low-coverage month is flagged and NEVER presented as fully reconciled
 * (AGENT_GUARDRAILS S5: always show coverage, never imply completeness —
 * unmatched is the default, not an error). No I/O.
 */

/** Below this %, a month is flagged low-coverage (shown as a gap, not "ties"). */
export const LOW_COVERAGE_THRESHOLD = 90;

export interface SummaryRowLike {
  trackerTotal: number;
  qbTotal: number;
  matchedTotal: number;
  varianceTotal: number;
  trackerOnlyTotal: number;
  qbOnlyTotal: number;
}

export interface PeriodSummaryLike {
  periodKey: string;
  rev: SummaryRowLike | null;
  cos: SummaryRowLike | null;
  gpTracker: number;
  gpQb: number;
  gpDelta: number;
}

const round2 = (n: number): number => Number(n.toFixed(2));

/** tracker − qb (signed). */
export function variance(tracker: number, qb: number): number {
  return round2(tracker - qb);
}

/**
 * matched ÷ tracker invoiced, as a percentage. `null` when there's no tracker
 * invoiced value for the slice (nothing to reconcile — show "—", never 100%).
 */
export function coveragePct(matched: number, trackerTotal: number): number | null {
  if (!trackerTotal) return null;
  return round2((matched / trackerTotal) * 100);
}

export interface MonthCoverage {
  /** Coverage on the revenue stream (matched ÷ tracker invoiced). */
  rev: number | null;
  /** Coverage on the cost stream. */
  cos: number | null;
  /** Overall: (rev matched + cos matched) ÷ (rev tracker + cos tracker). */
  overall: number | null;
  /** True when overall coverage is known AND below the low-coverage threshold. */
  low: boolean;
  /** True when the period has any tracker-invoiced value at all. */
  hasInvoicedValue: boolean;
}

/** Per-month coverage across REV + COS, with the low-coverage flag. */
export function monthCoverage(p: PeriodSummaryLike): MonthCoverage {
  const revMatched = p.rev?.matchedTotal ?? 0;
  const revTracker = p.rev?.trackerTotal ?? 0;
  const cosMatched = p.cos?.matchedTotal ?? 0;
  const cosTracker = p.cos?.trackerTotal ?? 0;
  const totalMatched = revMatched + cosMatched;
  const totalTracker = revTracker + cosTracker;
  const overall = coveragePct(totalMatched, totalTracker);
  return {
    rev: coveragePct(revMatched, revTracker),
    cos: coveragePct(cosMatched, cosTracker),
    overall,
    low: overall != null && overall < LOW_COVERAGE_THRESHOLD,
    hasInvoicedValue: totalTracker > 0,
  };
}

/** Display label for a coverage %, integrity-safe ("—" when not applicable). */
export function coverageLabel(pct: number | null): string {
  return pct == null ? "—" : `${pct.toFixed(1)}%`;
}
