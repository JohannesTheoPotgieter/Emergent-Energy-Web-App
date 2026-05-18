/**
 * Smart Import — tolerant value normalization for change/conflict detection.
 *
 * Used by both the row-matcher (CHANGED vs UNCHANGED classification) and
 * the conflict-engine (3-way merge). Centralised here so the same tolerance
 * rules apply everywhere — otherwise a tiny float drift on `budgetTotal`
 * could be silently accepted as CHANGED by the matcher but then re-flagged
 * as a CONFLICT by the merge step (or vice versa).
 *
 * What it normalises:
 *   - null / undefined / empty / "0" / 0 / false → "" (already true today)
 *   - Numeric fields: parsed as Number and rounded to 2dp so |a−b|<0.005
 *     compares equal. Strips currency symbols (R, $, ZAR, commas).
 *   - Date fields: parsed and rendered as YYYY-MM-DD only, so Excel ISO
 *     drift (e.g. "2026-05-01" vs "2026-05-01T00:00:00.000Z") compares
 *     equal. Time-of-day is intentionally discarded — the trackers do not
 *     carry meaningful intra-day precision.
 *
 * The base `normalizeBasic` is the legacy behaviour (no field knowledge);
 * `normalizeWithFieldType` is the smarter one used when the caller knows
 * the field name. Callers that don't pass a field name fall back to
 * `normalizeBasic`, preserving current behaviour for unknown fields.
 */

export type FieldType = "numeric" | "date" | "text";

/**
 * Fields that carry monetary or quantity values across the three
 * tracker sections. These get 2dp numeric tolerance.
 */
export const NUMERIC_FIELDS: ReadonlySet<string> = new Set([
  // PLAN
  "durationDays", "actualDurationDays", "pctComplete", "expectedPctComplete",
  "workDays",
  // REVENUE
  "amountExVat", "vat", "milestonePercent",
  // EXPENDITURE
  "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
  "actualQty", "actualRate", "savingOverrun",
  "usdExchangeRate", "pricePerWatt", "revenueRecognitionAmount",
]);

/**
 * Fields that hold a calendar date. These get YYYY-MM-DD normalisation
 * so timezone / time-of-day drift does not produce a false CONFLICT.
 */
export const DATE_FIELDS: ReadonlySet<string> = new Set([
  "startDate", "endDate", "actualStartDate", "actualEndDate",
  "invoiceDate", "expectedPaymentDate", "paidDate", "inBankDate",
  "approvedDate", "forecastPaymentDate",
]);

export function getFieldType(fieldName: string): FieldType {
  if (NUMERIC_FIELDS.has(fieldName)) return "numeric";
  if (DATE_FIELDS.has(fieldName)) return "date";
  return "text";
}

/**
 * Legacy normalisation (no field-type knowledge). Treats null, undefined,
 * empty string, false and 0 as equivalent empty values. Identical to the
 * old `normVal` / `normalizeForCompare` so callers without a field name
 * keep their current semantics.
 */
export function normalizeBasic(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "";
  if (typeof val === "number") return val === 0 ? "" : String(val);
  const s = String(val).trim();
  return s === "0" ? "" : s;
}

const NUMERIC_TOLERANCE = 0.005;

function tryParseNumeric(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "boolean") return null;
  const stripped = String(val)
    .trim()
    .replace(/^(?:zar|usd|r|\$)\s*/i, "")
    .replace(/[,_\s]/g, "");
  if (stripped === "" || stripped === "-") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

function normalizeNumeric(val: unknown): string {
  const n = tryParseNumeric(val);
  if (n === null) {
    // Not parseable as a number — fall through to basic normalisation so
    // genuinely-different non-numeric strings still register as changes.
    return normalizeBasic(val);
  }
  if (Math.abs(n) < NUMERIC_TOLERANCE) return ""; // 0 / 0.0 / 0.00…
  // Round to 2dp; strip trailing zeros so "1234.50" and "1234.5" compare equal.
  const rounded = Math.round(n / NUMERIC_TOLERANCE) * NUMERIC_TOLERANCE;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function tryParseDate(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  // Already a Date instance.
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "number") {
    // Excel serial date numbers are also possible here, but the normalizer
    // upstream already converts those to ISO strings before the comparator
    // runs, so we treat raw numbers as ambiguous and skip.
    return null;
  }
  const s = String(val).trim();
  if (!s) return null;
  // Strict prefix match: anything that starts with YYYY-MM-DD is treated as
  // the same calendar date regardless of trailing time / timezone.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Slash form (YYYY/MM/DD).
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
  if (slash) {
    const m = slash[2].padStart(2, "0");
    const d = slash[3].padStart(2, "0");
    return `${slash[1]}-${m}-${d}`;
  }
  // Fall back to Date parser for anything else (e.g. "1 May 2026").
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeDate(val: unknown): string {
  const d = tryParseDate(val);
  if (d === null) return normalizeBasic(val);
  return d;
}

/**
 * Field-aware normalisation. Pass the field name (e.g. "amountExVat")
 * and we apply numeric tolerance / date normalisation when appropriate;
 * otherwise we fall back to `normalizeBasic`.
 */
export function normalizeWithFieldType(val: unknown, fieldName?: string): string {
  if (!fieldName) return normalizeBasic(val);
  const t = getFieldType(fieldName);
  if (t === "numeric") return normalizeNumeric(val);
  if (t === "date") return normalizeDate(val);
  return normalizeBasic(val);
}

/**
 * Coerce a percent-style value to the canonical 0..1 scale.
 *
 * Excel cells formatted as percentages give us numbers in 0..1 (e.g. 0.75
 * for "75%"); cells formatted as plain numbers give us 0..100. The Tracker
 * uses both conventions across columns, and historically Smart Import
 * wrote whatever Excel handed back. The downstream readers split: some
 * assume 0..1 and multiply by 100 (program-dashboard-repository,
 * kpi-service), others assume 0..100 and compare raw (dashboard-repository
 * behind-plan widget). The mixed convention produced silent
 * misclassification — same `work_items` row showing on track on the Plan
 * tab but behind on the dashboard.
 *
 * Canonical scale: **0..1**. This helper makes the contract explicit at
 * the write boundary so every reader can rely on the same range.
 *
 * Rules:
 *   - null / undefined / NaN / non-numeric strings → null
 *   - 0..1 (inclusive) → returned as-is
 *   - >1..100 → divided by 100 (treated as 0..100 percentage)
 *   - >100 → clamped to 1 (defensive against runaway values)
 *   - negative → clamped to 0
 *
 * See docs/smart-import-v2-task-dedup-audit.md (Fix 4a).
 */
export function clampPercent(val: unknown): number | null {
  const n = tryParseNumeric(val);
  if (n === null) return null;
  if (n < 0) return 0;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return 1;
}
