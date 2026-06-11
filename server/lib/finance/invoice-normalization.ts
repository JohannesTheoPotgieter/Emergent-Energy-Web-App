/**
 * Configurable invoice-number canonicalisation + residual-unmatched reasons
 * (G7 — hardening the tracker↔QuickBooks match key). Pure: no I/O, no DB, no QB.
 *
 * WHY CONFIGURABLE: the real-world QB + tracker invoice formats (supplier
 * prefixes, separators, leading zeros, year segments, credit-note markers) are
 * still being catalogued — the owner will supply ~12 real examples. Until those
 * land we must NOT silently change the live match key, so the DEFAULT config
 * reproduces today's engine behaviour EXACTLY (`digits_no_leading_zeros`, the
 * QB_RECON_NORMALIZER in qb-tracker-reconcile.ts). The HARDENED preset is the
 * opt-in candidate; switch only once validated against real data + owner sign-off
 * (finance match key is frozen — see AGENT_GUARDRAILS § 3B / S10).
 *
 * The residual-reason classifier makes coverage EXPLAINABLE: every unmatched
 * invoice gets a reason (blank number, credit note, no counterpart, amount
 * variance, ambiguous collision) so "why didn't it match?" is always answerable.
 */

export interface InvoiceNormConfig {
  /** Lowercase the result (no-op for digits-only, but matters when keeping alpha). */
  lowercase: boolean;
  /**
   * Detect + strip a leading credit-note marker (CN / CRN / CR- / "CREDIT")
   * before other steps, and report it, so a credit note doesn't silently
   * collide with the invoice it reverses.
   */
  markCreditNotes: boolean;
  /**
   * Keep digits only (folds supplier alpha prefixes AND separators). When false,
   * keep alphanumerics and strip only separators (the looser, alpha-preserving
   * key — useful when suppliers reuse the same digits across series).
   */
  digitsOnly: boolean;
  /** Strip leading zeros from the resulting run ("00123" → "123"). */
  stripLeadingZeros: boolean;
  /**
   * Drop a leading 4-digit calendar-year segment (2015–2099) when the number is
   * YEAR + serial, so "2025-0042" aligns with "0042". OFF by default — it
   * changes which invoices match, so it stays opt-in until validated.
   */
  dropLeadingYearSegment: boolean;
}

/**
 * EXACTLY today's engine key: lowercase + digitsOnly + stripLeadingZeros ==
 * `NORMALIZERS.digits_no_leading_zeros`. Changing this is a frozen-match-key
 * change and needs owner sign-off — do not flip the defaults to "harden" the
 * live engine without the real-example catalogue.
 */
export const DEFAULT_INVOICE_NORM_CONFIG: InvoiceNormConfig = {
  lowercase: true,
  markCreditNotes: false,
  digitsOnly: true,
  stripLeadingZeros: true,
  dropLeadingYearSegment: false,
};

/**
 * Candidate hardened key — handles credit-note markers + leading year segments
 * on top of the default. Surfaced for measurement (before/after match rate);
 * NOT wired into the live engine until validated against the real examples.
 */
export const HARDENED_INVOICE_NORM_CONFIG: InvoiceNormConfig = {
  lowercase: true,
  markCreditNotes: true,
  digitsOnly: true,
  stripLeadingZeros: true,
  dropLeadingYearSegment: true,
};

export interface CanonicalResult {
  /** The match key. Empty string when there is no usable number. */
  canonical: string;
  /** Pipeline steps that actually changed the value — for explainability. */
  applied: string[];
  /** True when a credit-note marker was detected (only when markCreditNotes). */
  isCreditNote: boolean;
  /** The raw credit-note marker found, if any. */
  creditNoteMarker: string | null;
}

const CREDIT_NOTE_RE = /^\s*(credit\s*note|cred|crn|cn|cr)[\s\-_/:#]*/i;
const YEAR_SEGMENT_RE = /^(20[1-9]\d|2099)(\d{2,})$/; // 2015–2099 + ≥2 serial digits

/**
 * Canonicalise one raw invoice number under a config. Deterministic + pure.
 * The `applied` list records which steps changed the string so the UI / probe
 * can explain how "ACME/2025/00042-CN" became "42".
 */
export function canonicalizeInvoiceNumber(
  raw: string | null | undefined,
  config: InvoiceNormConfig = DEFAULT_INVOICE_NORM_CONFIG,
): CanonicalResult {
  const applied: string[] = [];
  let isCreditNote = false;
  let creditNoteMarker: string | null = null;

  let value = raw == null ? "" : String(raw);

  if (config.markCreditNotes) {
    const m = value.match(CREDIT_NOTE_RE);
    if (m) {
      isCreditNote = true;
      creditNoteMarker = m[1] ?? m[0].trim();
      value = value.slice(m[0].length);
      applied.push("strip_credit_note_marker");
    }
  }

  if (config.lowercase) {
    const lowered = value.toLowerCase();
    if (lowered !== value) applied.push("lowercase");
    value = lowered;
  }

  if (config.digitsOnly) {
    const digits = value.replace(/\D/g, "");
    if (digits !== value) applied.push("digits_only");
    value = digits;
  } else {
    const alnum = value.replace(/[^a-zA-Z0-9]/g, "");
    if (alnum !== value) applied.push("strip_separators");
    value = alnum;
  }

  if (config.dropLeadingYearSegment) {
    const ym = value.match(YEAR_SEGMENT_RE);
    if (ym) {
      value = ym[2]!;
      applied.push("drop_leading_year_segment");
    }
  }

  if (config.stripLeadingZeros) {
    const stripped = value.replace(/^0+/, "");
    if (stripped !== value) applied.push("strip_leading_zeros");
    value = stripped;
  }

  return { canonical: value, applied, isCreditNote, creditNoteMarker };
}

/** Convenience: just the key, matching the `(raw) => string` normaliser shape. */
export function canonicalKey(
  raw: string | null | undefined,
  config: InvoiceNormConfig = DEFAULT_INVOICE_NORM_CONFIG,
): string {
  return canonicalizeInvoiceNumber(raw, config).canonical;
}

// ─────────────────────────────────────────────────────────────────────────
// Residual-unmatched reasons — make coverage explainable
// ─────────────────────────────────────────────────────────────────────────

export type UnmatchedReason =
  | "blank_number" // no usable number to match on
  | "credit_note" // canonicalises to a credit note (reverses an invoice)
  | "no_counterpart" // canonical key has no match on the other side
  | "amount_variance" // number matched, ex-VAT amount differs beyond tolerance
  | "ambiguous_collision"; // canonical key folds >1 distinct raw number → not 1:1

export const UNMATCHED_REASONS: readonly UnmatchedReason[] = [
  "blank_number",
  "credit_note",
  "no_counterpart",
  "amount_variance",
  "ambiguous_collision",
];

export interface ResidualInput {
  rawNumber: string | null;
  canonical: string;
  /** Other side has the same canonical key. */
  hasCounterpart: boolean;
  /** number matched + amount within tolerance. null when no counterpart. */
  amountMatched: boolean | null;
  /** This canonical key aggregated >1 distinct raw number on either side. */
  collision: boolean;
  /** Canonicaliser flagged a credit-note marker. */
  isCreditNote: boolean;
}

/**
 * Why did this invoice not cleanly match? Order matters: a blank number can't
 * match at all; a collision is ambiguous regardless of amount; a credit note is
 * called out before "no counterpart" so the operator knows it's a reversal.
 */
export function classifyUnmatchedReason(input: ResidualInput): UnmatchedReason {
  if (!input.canonical) return "blank_number";
  if (input.collision) return "ambiguous_collision";
  if (input.isCreditNote) return "credit_note";
  if (!input.hasCounterpart) return "no_counterpart";
  if (input.amountMatched === false) return "amount_variance";
  // Matched: not a residual. Callers should not ask, but default sensibly.
  return "no_counterpart";
}

export interface InvoiceLike {
  number: string | null;
  amountExVat: number;
}

export interface MatchWithReasonsResult {
  config: InvoiceNormConfig;
  tolerance: number;
  trackerTotalValue: number;
  matchedTrackerValue: number;
  /** matched value ÷ tracker total, by VALUE (the headline coverage). */
  matchRateByValue: number;
  /** Per-side residual breakdown by reason: count + ex-VAT value. */
  trackerResiduals: Record<UnmatchedReason, { count: number; value: number }>;
  qbResiduals: Record<UnmatchedReason, { count: number; value: number }>;
}

interface Agg {
  value: number;
  rawNumbers: string[];
  isCreditNote: boolean;
}

function aggregate(
  records: readonly InvoiceLike[],
  config: InvoiceNormConfig,
): { byKey: Map<string, Agg>; blank: { count: number; value: number } } {
  const byKey = new Map<string, Agg>();
  const blank = { count: 0, value: 0 };
  for (const r of records) {
    const c = canonicalizeInvoiceNumber(r.number, config);
    if (!c.canonical) {
      blank.count += 1;
      blank.value += r.amountExVat;
      continue;
    }
    const slot = byKey.get(c.canonical) ?? { value: 0, rawNumbers: [], isCreditNote: false };
    slot.value += r.amountExVat;
    if (r.number && !slot.rawNumbers.includes(r.number)) slot.rawNumbers.push(r.number);
    slot.isCreditNote = slot.isCreditNote || c.isCreditNote;
    byKey.set(c.canonical, slot);
  }
  return { byKey, blank };
}

const emptyResiduals = (): Record<UnmatchedReason, { count: number; value: number }> => ({
  blank_number: { count: 0, value: 0 },
  credit_note: { count: 0, value: 0 },
  no_counterpart: { count: 0, value: 0 },
  amount_variance: { count: 0, value: 0 },
  ambiguous_collision: { count: 0, value: 0 },
});

const round2 = (n: number): number => Number(n.toFixed(2));

/**
 * Match QB ↔ tracker on a config's canonical key and explain every residual.
 * This is the "before/after match rate + residual reasons" the owner asked for:
 * run it with DEFAULT_INVOICE_NORM_CONFIG (before) and a candidate config
 * (after) and compare `matchRateByValue` + the residual breakdowns.
 */
export function matchWithReasons(
  qb: readonly InvoiceLike[],
  tracker: readonly InvoiceLike[],
  config: InvoiceNormConfig = DEFAULT_INVOICE_NORM_CONFIG,
  tolerance = 1,
): MatchWithReasonsResult {
  const qbAgg = aggregate(qb, config);
  const trAgg = aggregate(tracker, config);

  let trackerTotalValue = 0;
  let matchedTrackerValue = 0;
  const trackerResiduals = emptyResiduals();
  const qbResiduals = emptyResiduals();

  trackerResiduals.blank_number = { count: trAgg.blank.count, value: round2(trAgg.blank.value) };
  qbResiduals.blank_number = { count: qbAgg.blank.count, value: round2(qbAgg.blank.value) };

  const classifyInto = (
    byKey: Map<string, Agg>,
    other: Map<string, Agg>,
    bucket: Record<UnmatchedReason, { count: number; value: number }>,
    isTracker: boolean,
  ) => {
    for (const [key, agg] of byKey) {
      const counterpart = other.get(key) ?? null;
      const hasCounterpart = counterpart != null;
      const collision = agg.rawNumbers.length > 1 || (counterpart?.rawNumbers.length ?? 0) > 1;
      const amountMatched = hasCounterpart
        ? Math.abs(round2(agg.value - counterpart!.value)) <= tolerance
        : null;
      if (isTracker) trackerTotalValue += agg.value;
      const cleanMatch = hasCounterpart && amountMatched === true && !collision && !agg.isCreditNote;
      if (cleanMatch) {
        if (isTracker) matchedTrackerValue += agg.value;
        continue;
      }
      const reason = classifyUnmatchedReason({
        rawNumber: agg.rawNumbers[0] ?? null,
        canonical: key,
        hasCounterpart,
        amountMatched,
        collision,
        isCreditNote: agg.isCreditNote,
      });
      bucket[reason].count += 1;
      bucket[reason].value = round2(bucket[reason].value + agg.value);
    }
  };

  classifyInto(trAgg.byKey, qbAgg.byKey, trackerResiduals, true);
  classifyInto(qbAgg.byKey, trAgg.byKey, qbResiduals, false);

  trackerTotalValue = round2(trackerTotalValue);
  matchedTrackerValue = round2(matchedTrackerValue);

  return {
    config,
    tolerance,
    trackerTotalValue,
    matchedTrackerValue,
    matchRateByValue: trackerTotalValue === 0 ? 0 : round2((matchedTrackerValue / trackerTotalValue) * 100),
    trackerResiduals,
    qbResiduals,
  };
}
