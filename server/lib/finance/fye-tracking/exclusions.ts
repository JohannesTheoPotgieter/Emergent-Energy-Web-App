/**
 * FYE Tracking — tracker scope, exclusions and de-duplication.
 *
 * The FYE tab reproduces the "FY26 Project Tracking (EE - from trackers)"
 * workbook: one (latest) tracker per project across Active + Past +
 * Compliance. Some folders / workbooks in the tracker source are archives,
 * groupings, or stale handover copies — not live projects — and must be
 * dropped before any total is computed.
 *
 * Two mechanisms, both intentionally explicit and *configurable* (not
 * hard-coded inline at the call site):
 *
 *   1. A named EXCLUSION LIST (this file's `DEFAULT_FYE_EXCLUSIONS`). Edit
 *      the list here, or override at runtime via the `FYE_EXCLUSIONS_JSON`
 *      env var, without touching the service logic.
 *   2. A structural DE-DUP rule (`isStaleTrackerCopy`): when two trackers
 *      resolve to the same project, the copy where *every* invoice/payment
 *      date is red and there are *no* invoice numbers is a stale budget /
 *      handover copy and is dropped in favour of the live/active one.
 *
 * Matching is deliberately precise so near-namesakes survive:
 *   - "BMG" is excluded but "BMG Fluid Tech" is kept.
 *   - "Maynard Mall" is excluded but "Maynard Mall Extension" is kept.
 *   - "Klein Karoo Markt" is excluded but "Klein Karoo Phase 2" is kept.
 * Hence the default match mode is EXACT on the normalised name. `startsWith`
 * / `contains` are available for folder-style entries where that is correct.
 */

export type FyeExclusionMatch = "exact" | "startsWith" | "contains";

export interface FyeExclusionRule {
  /** Human-readable note on why this entry exists. */
  label: string;
  /** The value to match against a project name / tracker file / folder segment. */
  value: string;
  /** How to compare. Defaults to "exact" (normalised) so namesakes survive. */
  match?: FyeExclusionMatch;
  /** Optional reason surfaced in diagnostics / the recon report. */
  reason?: string;
}

/**
 * Canonical default exclusions. These are folder/tracker artefacts in the
 * source — archives, groupings, or stale copies — that are NOT projects.
 *
 * Keep this list curated and commented. New archive folders go here; do not
 * scatter name checks through the service.
 */
export const DEFAULT_FYE_EXCLUSIONS: readonly FyeExclusionRule[] = [
  { label: "99. Old", value: "99. Old", match: "contains", reason: "Archive folder of superseded trackers" },
  { label: "Dipula", value: "Dipula", match: "exact", reason: "Portfolio grouping folder, not a project" },
  // "BMG" the grouping vs "BMG Fluid Tech" the live project — exact only.
  { label: "BMG", value: "BMG", match: "exact", reason: "Grouping; live project is 'BMG Fluid Tech'" },
  // "Klein Karoo Markt" stale vs "Klein Karoo Phase 2" live.
  { label: "Klein Karoo Markt", value: "Klein Karoo Markt", match: "exact", reason: "Stale; live project is 'Klein Karoo Phase 2'" },
  // "Maynard Mall" stale vs "Maynard Mall Extension" live — exact so the
  // Extension is not swept up by a prefix match.
  { label: "Maynard Mall", value: "Maynard Mall", match: "exact", reason: "Stale; live project is 'Maynard Mall Extension'" },
  { label: "Supa Store", value: "Supa Store", match: "exact", reason: "Grouping / non-project artefact" },
  { label: "IconSA Benoni", value: "IconSA Benoni", match: "exact", reason: "Duplicate / non-project artefact" },
  { label: "The Avenues", value: "The Avenues", match: "exact", reason: "Grouping / non-project artefact" },
  // Stale Compliance copy of the live Superspar Ph2 — also caught by the
  // structural de-dup rule (all dates red, no invoices), listed here too so
  // it is dropped even if a stray invoice number sneaks into the copy.
  {
    label: "Superspar Despatch Phase 2",
    value: "Superspar Despatch Phase 2",
    match: "exact",
    reason: "Stale Compliance copy of the live Superspar Ph2",
  },
];

/** Normalise a name/folder for comparison: trim, collapse internal whitespace,
 * lower-case. Punctuation is preserved so "99. Old" stays distinct. */
export function normalizeExclusionKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip a Smart Import source file name down to a comparable label, e.g.
 * "Superspar_Despatch_Phase_2_Tracker_1779.xlsx" → "superspar despatch phase 2".
 * Underscores → spaces, trailing "_<digits>" import suffix and a trailing
 * "tracker"/extension removed. Best-effort; the project name is the primary
 * signal and this is a fallback for folder/file-only artefacts. */
export function fileNameToComparableLabel(fileName: string | null | undefined): string {
  if (!fileName) return "";
  let base = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  base = base.replace(/[_]+/g, " ");
  // Drop the numeric import suffix Smart Import appends (e.g. "... 1779108373976").
  base = base.replace(/\s+\d{6,}$/g, "");
  // Drop a trailing "tracker" / "rev0x" token.
  base = base.replace(/\s+(tracker|rev\s*\d+)\b.*$/i, "");
  return normalizeExclusionKey(base);
}

function ruleMatches(rule: FyeExclusionRule, candidate: string): boolean {
  const target = normalizeExclusionKey(rule.value);
  if (!candidate || !target) return false;
  switch (rule.match ?? "exact") {
    case "contains":
      return candidate.includes(target);
    case "startsWith":
      return candidate.startsWith(target);
    case "exact":
    default:
      return candidate === target;
  }
}

export interface ExclusionDecision {
  excluded: boolean;
  rule: FyeExclusionRule | null;
}

/**
 * Decide whether a tracker/project is excluded by the configured list. The
 * candidate strings are matched against every rule; the first hit wins.
 *
 * @param candidates name-like strings to test (project name, source file
 *        label, folder segments). All are normalised internally.
 */
export function evaluateExclusion(
  candidates: Array<string | null | undefined>,
  rules: readonly FyeExclusionRule[] = resolveFyeExclusions(),
): ExclusionDecision {
  const normalized = candidates
    .map((c) => normalizeExclusionKey(c))
    .filter((c) => c.length > 0);
  for (const rule of rules) {
    for (const cand of normalized) {
      if (ruleMatches(rule, cand)) return { excluded: true, rule };
    }
    // Also test the file-name-derived label form against name-style rules.
  }
  return { excluded: false, rule: null };
}

/**
 * Resolve the active exclusion list. Defaults to {@link DEFAULT_FYE_EXCLUSIONS};
 * an operator can override per-environment with `FYE_EXCLUSIONS_JSON` (a JSON
 * array of {label,value,match?,reason?}). Invalid JSON falls back to defaults
 * and is non-fatal. This keeps the list configurable without a code change.
 */
export function resolveFyeExclusions(
  envValue: string | undefined = process.env.FYE_EXCLUSIONS_JSON,
): readonly FyeExclusionRule[] {
  if (!envValue) return DEFAULT_FYE_EXCLUSIONS;
  try {
    const parsed = JSON.parse(envValue) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_FYE_EXCLUSIONS;
    const rules: FyeExclusionRule[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object" && typeof (item as FyeExclusionRule).value === "string") {
        const r = item as FyeExclusionRule;
        rules.push({
          label: typeof r.label === "string" ? r.label : r.value,
          value: r.value,
          match: r.match === "contains" || r.match === "startsWith" ? r.match : "exact",
          reason: typeof r.reason === "string" ? r.reason : undefined,
        });
      }
    }
    return rules.length ? rules : DEFAULT_FYE_EXCLUSIONS;
  } catch {
    return DEFAULT_FYE_EXCLUSIONS;
  }
}

/**
 * Per-tracker realisation signal summary used by the structural de-dup rule.
 * Computed by the service from a project's imported lines.
 */
export interface TrackerSignalSummary {
  /** Any cost/revenue line carries a non-placeholder invoice number. */
  hasAnyInvoiceNumber: boolean;
  /** Any date cell is BLACK/confirmed (a real "actual" happened). */
  hasAnyBlackDate: boolean;
  /** Total imported lines considered (guards the "empty tracker" case). */
  lineCount: number;
}

/**
 * A tracker is a stale budget / handover copy when it has *no* invoice numbers
 * AND *no* black (confirmed) dates — i.e. every payment/invoice date is red and
 * nothing has actually been realised. Such a copy is dropped in favour of the
 * live/active tracker for the same project (de-dup rule).
 *
 * The `lineCount > 0` guard avoids classifying a genuinely empty/not-yet-
 * imported tracker as "stale" purely because it has no signals.
 */
export function isStaleTrackerCopy(summary: TrackerSignalSummary): boolean {
  return summary.lineCount > 0 && !summary.hasAnyInvoiceNumber && !summary.hasAnyBlackDate;
}
