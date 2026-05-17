/**
 * Canonical ZAR money formatting — the single source of truth.
 *
 * Integrity rule (UI/UX audit X2): a null / undefined / non-numeric value is
 * NOT money. It renders as an em dash ("—"), never "R 0". Only a genuine
 * numeric zero renders as R 0. This keeps "we have no data" visually distinct
 * from "the value is zero".
 *
 * - formatZar      — precise en-ZA ZAR for cells, panels, tooltips (default).
 * - formatZarCompact — abbreviated (R1,2M) for chart axes / dense tiles only.
 *                      Pair with a title/tooltip exposing the exact figure.
 */

const PRECISE = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PRECISE_CENTS = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Intl en-ZA emits no-break (U+00A0) and narrow-no-break (U+202F) spaces.
 * Normalise to a plain ASCII space: visually identical, but deterministic for
 * comparison/snapshot/test and safe to copy out of the UI.
 */
function ascii(s: string): string {
  return s.replace(/[\u00A0\u202F]/g, " ");
}

/** True only for a finite number. Strings, null, undefined, NaN are not money. */
function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface FormatZarOptions {
  /** Show cents. Default false (whole Rand, matching the finance reference). */
  cents?: boolean;
  /** Prefix non-negative values with "+". Default false. */
  showSign?: boolean;
  /** Placeholder for absent/non-numeric values. Default "—". */
  placeholder?: string;
}

/** Precise en-ZA ZAR. Absent / non-numeric → placeholder ("—"). */
export function formatZar(value: unknown, options: FormatZarOptions = {}): string {
  const { cents = false, showSign = false, placeholder = "—" } = options;
  const n = asFiniteNumber(value);
  if (n === null) return placeholder;
  const sign = showSign && n > 0 ? "+" : "";
  return ascii(`${sign}${(cents ? PRECISE_CENTS : PRECISE).format(n)}`);
}

/** Alias — explicit "full precision" name for call sites that want clarity. */
export const formatZarFull = (value: unknown, options?: FormatZarOptions): string =>
  formatZar(value, options);

/**
 * Abbreviated ZAR for chart axes and dense KPI tiles ONLY.
 * Absent / non-numeric → placeholder. Always surface the exact figure via a
 * title/tooltip next to any compact value.
 */
export function formatZarCompact(value: unknown, placeholder = "—"): string {
  const n = asFiniteNumber(value);
  if (n === null) return placeholder;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}R${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}R${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}R${(abs / 1_000).toFixed(0)}K`;
  return `${sign}R${abs.toFixed(0)}`;
}

/** Plain integer count with en-ZA thousands separators. Absent → placeholder. */
export function formatCount(value: unknown, placeholder = "—"): string {
  const n = asFiniteNumber(value);
  if (n === null) return placeholder;
  return ascii(n.toLocaleString("en-ZA", { maximumFractionDigits: 0 }));
}
