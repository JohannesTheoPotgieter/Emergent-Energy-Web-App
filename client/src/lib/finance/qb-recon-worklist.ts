/**
 * Pure worklist logic for the QuickBooks Reconciliation view.
 *
 * Buckets recon lines into the same day/week/month periods the server summary
 * uses (periodKeyFor mirrors server/services/qb-tracker-reconcile.ts), and
 * builds the period worklist: clean matches hidden; amount-variance first, then
 * tracker-only, qb-only, timing; ties broken by descending value. No I/O.
 */

export type Grain = "day" | "week" | "month";
export type Stream = "COS" | "REV";
export type LineStatus = "matched" | "amount_variance" | "tracker_only" | "qb_only";
export type DisplayStatus = "amount_variance" | "tracker_only" | "qb_only" | "timing" | "matched";

/**
 * The four reconciliation states surfaced in the invoice worklist (G3). They
 * are a DISPLAY mapping over the engine's persisted statuses — no number change:
 *   matched              ← clean match (number + ex-VAT amount tie within R1)
 *   unmatched_in_qb      ← tracker has the invoice, QuickBooks doesn't (tracker_only)
 *   unmatched_in_tracker ← QuickBooks has it, the tracker doesn't (qb_only)
 *   ambiguous            ← number matched but amount disagrees (amount_variance),
 *                          OR the normalised number folds >1 raw invoice (collision)
 *                          — the 1:1 tracker↔QB mapping is uncertain.
 * GP is never shown per invoice (a client invoice and a supplier bill are
 * different documents) — the worklist is REV-side or COS-side only.
 */
export type MatchState = "matched" | "unmatched_in_qb" | "unmatched_in_tracker" | "ambiguous";

export interface ReconLineLike {
  trackerAmountExVat: string | number | null;
  qbAmountExVat: string | number | null;
  delta: string | number | null;
  status: LineStatus;
  trackerDate: string | null;
  qbDate: string | null;
  timingFlag: boolean;
  /** COS or REV — needed to split the worklist by side. */
  stream?: Stream;
  /** Raw invoice number(s); a "|" means the normalised key folded several. */
  invoiceNoRaw?: string | null;
  invoiceNoNorm?: string;
}

const num = (v: string | number | null): number => (v == null ? 0 : Number(v) || 0);

/** ISO-week key (YYYY-Www, Monday-start) — mirrors the server. */
export function isoWeekKey(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const ft = new Date(Date.UTC(year, 0, 4));
  const ftDay = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((d.getTime() - ft.getTime()) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function periodKeyFor(iso: string, grain: Grain): string {
  const d = iso.slice(0, 10);
  if (grain === "day") return d;
  if (grain === "month") return d.slice(0, 7);
  return isoWeekKey(d);
}

export function displayStatus(l: ReconLineLike): DisplayStatus {
  if (l.status === "matched") return l.timingFlag ? "timing" : "matched";
  return l.status;
}

export const WORKLIST_ORDER: Record<DisplayStatus, number> = {
  amount_variance: 0,
  tracker_only: 1,
  qb_only: 2,
  timing: 3,
  matched: 4,
};

export function lineValue(l: ReconLineLike): number {
  return Math.abs(num(l.trackerAmountExVat) || num(l.qbAmountExVat));
}

/** The period's worklist: clean matches removed, ordered by status then value
 *  (or purely by value when `sortByValue`). */
export function buildWorklist<T extends ReconLineLike>(
  lines: readonly T[],
  periodKey: string,
  grain: Grain,
  sortByValue: boolean,
): T[] {
  const inPeriod = lines.filter((l) => {
    const d = l.trackerDate ?? l.qbDate;
    return d != null && periodKeyFor(d, grain) === periodKey;
  });
  const items = inPeriod.filter((l) => displayStatus(l) !== "matched");
  return [...items].sort((a, b) => {
    if (!sortByValue) {
      const o = WORKLIST_ORDER[displayStatus(a)] - WORKLIST_ORDER[displayStatus(b)];
      if (o !== 0) return o;
    }
    return lineValue(b) - lineValue(a);
  });
}

// ─── Four-state, side-split worklist (G3) ──────────────────────────────────

/** A normalised invoice number that folded more than one raw number → not 1:1. */
export function isCollision(l: ReconLineLike): boolean {
  return typeof l.invoiceNoRaw === "string" && l.invoiceNoRaw.includes("|");
}

/** Map an engine line to one of the four worklist states (display only). */
export function matchState(l: ReconLineLike): MatchState {
  // AMBIGUOUS first: a collision OR a number-match whose amounts disagree both
  // mean we can't assert a clean 1:1 tracker↔QB pairing.
  if (isCollision(l) || l.status === "amount_variance") return "ambiguous";
  if (l.status === "tracker_only") return "unmatched_in_qb";
  if (l.status === "qb_only") return "unmatched_in_tracker";
  return "matched"; // includes timing — surfaced as a sub-flag, still a match
}

export const MATCH_STATE_ORDER: Record<MatchState, number> = {
  ambiguous: 0,
  unmatched_in_qb: 1,
  unmatched_in_tracker: 2,
  matched: 3,
};

export interface SideWorklist<T extends ReconLineLike> {
  stream: Stream;
  matched: T[];
  ambiguous: T[];
  unmatchedInQb: T[];
  unmatchedInTracker: T[];
  /** Count of items needing attention (everything except clean matches). */
  openCount: number;
}

const byValueDesc = <T extends ReconLineLike>(a: T, b: T): number => lineValue(b) - lineValue(a);

/**
 * Build one side's (REV or COS) worklist for a period, grouped into the four
 * states. Unlike `buildWorklist`, matches are KEPT (the worklist shows all four
 * states per the spec) — the UI collapses the matched group by default. Each
 * group is sorted by descending value.
 */
export function buildSideWorklist<T extends ReconLineLike>(
  lines: readonly T[],
  periodKey: string,
  grain: Grain,
  stream: Stream,
): SideWorklist<T> {
  const inScope = lines.filter((l) => {
    if (l.stream !== stream) return false;
    const d = l.trackerDate ?? l.qbDate;
    return d != null && periodKeyFor(d, grain) === periodKey;
  });
  const matched: T[] = [];
  const ambiguous: T[] = [];
  const unmatchedInQb: T[] = [];
  const unmatchedInTracker: T[] = [];
  for (const l of inScope) {
    switch (matchState(l)) {
      case "matched":
        matched.push(l);
        break;
      case "ambiguous":
        ambiguous.push(l);
        break;
      case "unmatched_in_qb":
        unmatchedInQb.push(l);
        break;
      case "unmatched_in_tracker":
        unmatchedInTracker.push(l);
        break;
    }
  }
  matched.sort(byValueDesc);
  ambiguous.sort(byValueDesc);
  unmatchedInQb.sort(byValueDesc);
  unmatchedInTracker.sort(byValueDesc);
  return {
    stream,
    matched,
    ambiguous,
    unmatchedInQb,
    unmatchedInTracker,
    openCount: ambiguous.length + unmatchedInQb.length + unmatchedInTracker.length,
  };
}
