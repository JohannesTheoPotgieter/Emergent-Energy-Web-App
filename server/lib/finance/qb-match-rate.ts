/**
 * QB invoice-number match-rate measurement (read-only analysis helper).
 *
 * Pure logic for `server/scripts/measure-qb-match-rate.ts`: given QuickBooks
 * documents and tracker lines (each reduced to {number, amountExVat}), it
 * normalises invoice numbers, aggregates to invoice (doc) grain per side, and
 * reports — per stream — matched / amount-variance / tracker-only / qb-only
 * counts AND values (ex-VAT), plus the resulting match rate BY VALUE.
 *
 * No I/O, no DB, no QuickBooks calls, no app state — safe to unit-test. The
 * `base` normalizer intentionally mirrors `normalizeInvoiceNumber` in
 * server/services/quickbooks-reconciliation-service.ts so the BASE row reflects
 * today's behaviour; the other variants are the stricter/looser candidates the
 * owner is evaluating. Measures only — changes no app behaviour.
 */

export type Stream = "COS" | "REV";

export interface InvoiceRecord {
  /** Raw invoice / QB DocNumber. */
  number: string | null;
  /** Ex-VAT amount. */
  amountExVat: number;
}

export type NormalizerName =
  | "base"
  | "base_no_leading_zeros"
  | "digits_only"
  | "digits_no_leading_zeros"
  | "alnum_last8";

const alnumLower = (v: string | null | undefined): string =>
  (v ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const digits = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");
const stripLeadingZeros = (s: string): string => s.replace(/^0+/, "");

/**
 * Candidate invoice-number normalizers, baseline first.
 *   base                     — EXACTLY today's normalizeInvoiceNumber (alnum+lc).
 *   base_no_leading_zeros    — base, then drop leading zeros ("INV-007" → "inv7").
 *   digits_only              — strip all non-digits (drops supplier alpha prefixes).
 *   digits_no_leading_zeros  — digits_only, then drop leading zeros.
 *   alnum_last8              — last 8 alnum chars (loosest; catches long prefixes).
 */
export const NORMALIZERS: Record<NormalizerName, (raw: string | null | undefined) => string> = {
  base: (v) => alnumLower(v),
  base_no_leading_zeros: (v) => stripLeadingZeros(alnumLower(v)),
  digits_only: (v) => digits(v),
  digits_no_leading_zeros: (v) => stripLeadingZeros(digits(v)),
  alnum_last8: (v) => {
    const a = alnumLower(v);
    return a.length <= 8 ? a : a.slice(-8);
  },
};

export const NORMALIZER_ORDER: NormalizerName[] = [
  "base",
  "base_no_leading_zeros",
  "digits_only",
  "digits_no_leading_zeros",
  "alnum_last8",
];

const round2 = (n: number): number => Number(n.toFixed(2));

export interface AggregatedInvoice {
  key: string;
  amountExVat: number;
  count: number;
  rawNumbers: string[];
}

/** Sum ex-VAT per normalized number. Records whose number normalises to "" are
 *  dropped (no number to match on) and reported separately by the caller. */
export function aggregateByNormalized(
  records: readonly InvoiceRecord[],
  normalize: (raw: string | null | undefined) => string,
): { byKey: Map<string, AggregatedInvoice>; blankCount: number; blankValue: number } {
  const byKey = new Map<string, AggregatedInvoice>();
  let blankCount = 0;
  let blankValue = 0;
  for (const r of records) {
    const key = normalize(r.number);
    if (!key) {
      blankCount += 1;
      blankValue += r.amountExVat;
      continue;
    }
    const slot = byKey.get(key) ?? { key, amountExVat: 0, count: 0, rawNumbers: [] };
    slot.amountExVat += r.amountExVat;
    slot.count += 1;
    if (r.number && !slot.rawNumbers.includes(r.number)) slot.rawNumbers.push(r.number);
    byKey.set(key, slot);
  }
  for (const s of byKey.values()) s.amountExVat = round2(s.amountExVat);
  return { byKey, blankCount, blankValue: round2(blankValue) };
}

export type MatchStatus = "matched" | "amount_variance" | "tracker_only" | "qb_only";

export interface MatchedInvoice {
  key: string;
  status: MatchStatus;
  qbAmount: number | null;
  trackerAmount: number | null;
  /** tracker − qb when both present. */
  delta: number | null;
  qbRaw: string[];
  trackerRaw: string[];
}

export interface MatchRateResult {
  stream: Stream;
  normalizer: NormalizerName;
  tolerance: number;

  qbInvoiceCount: number;
  trackerInvoiceCount: number;
  qbBlankNumberCount: number;
  trackerBlankNumberCount: number;

  matchedCount: number;
  amountVarianceCount: number;
  trackerOnlyCount: number;
  qbOnlyCount: number;

  qbTotalValue: number;
  trackerTotalValue: number;
  matchedTrackerValue: number;
  matchedQbValue: number;
  amountVarianceTrackerValue: number;
  amountVarianceQbValue: number;
  amountVarianceAbsDelta: number;
  trackerOnlyValue: number;
  qbOnlyValue: number;

  /** Headline: number + amount within tolerance, by VALUE. */
  trackerMatchRateByValue: number;
  qbMatchRateByValue: number;
  /** Number-only match (matched + amount_variance), by value. */
  trackerNumberMatchRateByValue: number;
  /** By count, for reference. */
  trackerMatchRateByCount: number;

  rows: MatchedInvoice[];
}

const pct = (num: number, den: number): number => (den === 0 ? 0 : round2((num / den) * 100));

/** Classify every normalized invoice number across both sides and total it. */
export function computeMatchRate(
  stream: Stream,
  qb: readonly InvoiceRecord[],
  tracker: readonly InvoiceRecord[],
  normalizer: NormalizerName,
  tolerance = 1,
): MatchRateResult {
  const normalize = NORMALIZERS[normalizer];
  const qbAgg = aggregateByNormalized(qb, normalize);
  const trAgg = aggregateByNormalized(tracker, normalize);

  const keys = new Set<string>([...qbAgg.byKey.keys(), ...trAgg.byKey.keys()]);
  const rows: MatchedInvoice[] = [];

  let matchedCount = 0;
  let amountVarianceCount = 0;
  let trackerOnlyCount = 0;
  let qbOnlyCount = 0;
  let matchedTrackerValue = 0;
  let matchedQbValue = 0;
  let amountVarianceTrackerValue = 0;
  let amountVarianceQbValue = 0;
  let amountVarianceAbsDelta = 0;
  let trackerOnlyValue = 0;
  let qbOnlyValue = 0;
  let qbTotalValue = 0;
  let trackerTotalValue = 0;

  for (const key of keys) {
    const q = qbAgg.byKey.get(key) ?? null;
    const t = trAgg.byKey.get(key) ?? null;
    if (q) qbTotalValue += q.amountExVat;
    if (t) trackerTotalValue += t.amountExVat;

    if (q && t) {
      const delta = round2(t.amountExVat - q.amountExVat);
      if (Math.abs(delta) <= tolerance) {
        matchedCount += 1;
        matchedTrackerValue += t.amountExVat;
        matchedQbValue += q.amountExVat;
        rows.push({ key, status: "matched", qbAmount: q.amountExVat, trackerAmount: t.amountExVat, delta, qbRaw: q.rawNumbers, trackerRaw: t.rawNumbers });
      } else {
        amountVarianceCount += 1;
        amountVarianceTrackerValue += t.amountExVat;
        amountVarianceQbValue += q.amountExVat;
        amountVarianceAbsDelta += Math.abs(delta);
        rows.push({ key, status: "amount_variance", qbAmount: q.amountExVat, trackerAmount: t.amountExVat, delta, qbRaw: q.rawNumbers, trackerRaw: t.rawNumbers });
      }
    } else if (t) {
      trackerOnlyCount += 1;
      trackerOnlyValue += t.amountExVat;
      rows.push({ key, status: "tracker_only", qbAmount: null, trackerAmount: t.amountExVat, delta: null, qbRaw: [], trackerRaw: t.rawNumbers });
    } else if (q) {
      qbOnlyCount += 1;
      qbOnlyValue += q.amountExVat;
      rows.push({ key, status: "qb_only", qbAmount: q.amountExVat, trackerAmount: null, delta: null, qbRaw: q.rawNumbers, trackerRaw: [] });
    }
  }

  qbTotalValue = round2(qbTotalValue);
  trackerTotalValue = round2(trackerTotalValue);

  return {
    stream,
    normalizer,
    tolerance,
    qbInvoiceCount: qbAgg.byKey.size,
    trackerInvoiceCount: trAgg.byKey.size,
    qbBlankNumberCount: qbAgg.blankCount,
    trackerBlankNumberCount: trAgg.blankCount,
    matchedCount,
    amountVarianceCount,
    trackerOnlyCount,
    qbOnlyCount,
    qbTotalValue,
    trackerTotalValue,
    matchedTrackerValue: round2(matchedTrackerValue),
    matchedQbValue: round2(matchedQbValue),
    amountVarianceTrackerValue: round2(amountVarianceTrackerValue),
    amountVarianceQbValue: round2(amountVarianceQbValue),
    amountVarianceAbsDelta: round2(amountVarianceAbsDelta),
    trackerOnlyValue: round2(trackerOnlyValue),
    qbOnlyValue: round2(qbOnlyValue),
    trackerMatchRateByValue: pct(matchedTrackerValue, trackerTotalValue),
    qbMatchRateByValue: pct(matchedQbValue, qbTotalValue),
    trackerNumberMatchRateByValue: pct(matchedTrackerValue + amountVarianceTrackerValue, trackerTotalValue),
    trackerMatchRateByCount: pct(matchedCount, trAgg.byKey.size),
    rows,
  };
}

/** Highest-value unmatched invoices on one side (for the "why didn't it match" review). */
export function topUnmatchedByValue(
  result: MatchRateResult,
  side: "tracker" | "qb",
  limit = 20,
): MatchedInvoice[] {
  const want: MatchStatus = side === "tracker" ? "tracker_only" : "qb_only";
  return result.rows
    .filter((r) => r.status === want)
    .sort((a, b) => (b[side === "tracker" ? "trackerAmount" : "qbAmount"] ?? 0) - (a[side === "tracker" ? "trackerAmount" : "qbAmount"] ?? 0))
    .slice(0, limit);
}

export interface NearMiss {
  looserKey: string;
  trackerRaw: string[];
  qbRaw: string[];
  trackerAmount: number;
  qbAmount: number;
  amountDelta: number;
}

/**
 * Pairs that DON'T match under `baseNormalizer` but WOULD under `looserNormalizer`
 * with amounts within tolerance — i.e. true near-misses the base rule dropped.
 * Shows the owner exactly why (supplier prefix, leading zero, punctuation, …).
 */
export function findNearMisses(
  qb: readonly InvoiceRecord[],
  tracker: readonly InvoiceRecord[],
  baseNormalizer: NormalizerName,
  looserNormalizer: NormalizerName,
  tolerance = 1,
  limit = 20,
): NearMiss[] {
  const base = NORMALIZERS[baseNormalizer];
  const looser = NORMALIZERS[looserNormalizer];
  const baseQb = aggregateByNormalized(qb, base).byKey;
  const baseTr = aggregateByNormalized(tracker, base).byKey;
  const looseQb = aggregateByNormalized(qb, looser).byKey;
  const looseTr = aggregateByNormalized(tracker, looser).byKey;

  const baseMatched = new Set<string>();
  for (const k of baseTr.keys()) if (baseQb.has(k)) baseMatched.add(k);

  const out: NearMiss[] = [];
  for (const [lk, t] of looseTr) {
    const q = looseQb.get(lk);
    if (!q) continue;
    // Already matched under base? (any raw number on this looser key already paired)
    const alreadyBase = t.rawNumbers.some((rn) => baseMatched.has(base(rn)));
    if (alreadyBase) continue;
    const delta = round2(t.amountExVat - q.amountExVat);
    if (Math.abs(delta) > tolerance) continue;
    out.push({ looserKey: lk, trackerRaw: t.rawNumbers, qbRaw: q.rawNumbers, trackerAmount: t.amountExVat, qbAmount: q.amountExVat, amountDelta: delta });
  }
  return out.sort((a, b) => b.trackerAmount - a.trackerAmount).slice(0, limit);
}
