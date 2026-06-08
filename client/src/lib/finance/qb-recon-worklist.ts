/**
 * Pure worklist logic for the QuickBooks Reconciliation view.
 *
 * Buckets recon lines into the same day/week/month periods the server summary
 * uses (periodKeyFor mirrors server/services/qb-tracker-reconcile.ts), and
 * builds the period worklist: clean matches hidden; amount-variance first, then
 * tracker-only, qb-only, timing; ties broken by descending value. No I/O.
 */

export type Grain = "day" | "week" | "month";
export type LineStatus = "matched" | "amount_variance" | "tracker_only" | "qb_only";
export type DisplayStatus = "amount_variance" | "tracker_only" | "qb_only" | "timing" | "matched";

export interface ReconLineLike {
  trackerAmountExVat: string | number | null;
  qbAmountExVat: string | number | null;
  delta: string | number | null;
  status: LineStatus;
  trackerDate: string | null;
  qbDate: string | null;
  timingFlag: boolean;
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
