// ============================================================
// DESIGN TOKENS — Emergent Energy
//
// Principles: truth · clear · simple.
//
// The visual system is **deliberately small**. The audit found
// pages using 6+ hues, 8+ font sizes, and badge soup with no
// semantic mapping. This module locks down the surface so every
// page reads the same way.
//
// Owner: Johannes Theo Potgieter (COO).
// Audit: 2026-05-27 (UX redesign PR-A).
// ============================================================

/**
 * The four semantic status levels. Every status badge, RAG dot,
 * KPI tile, drilldown header, and progress signal uses one of
 * these. We deliberately do NOT have "blue" or "orange" tokens —
 * blue collapses into `neutral`, orange into `warning`.
 *
 * Mapping cheatsheet for the most common dropped colours:
 *   blue-*    →  neutral / info  →  use slate-*
 *   orange-*  →  warning         →  use amber-*
 *   purple-*  →  audit-only      →  not a status; route to neutral
 *   sky-*     →  in-progress     →  use neutral (or amber when at-risk)
 */
export type StatusLevel = "healthy" | "warning" | "critical" | "neutral";

/**
 * Returns the Tailwind classes for a given status level. The
 * `variant` argument selects which visual treatment to apply:
 *   - `soft` — light background, dark text. Best for badges / inline pills.
 *   - `solid` — saturated background, white text. Best for primary CTAs.
 *   - `outline` — border + text only. Best for filter tabs / chips.
 *   - `text` — text colour only. Best for KPI tile values.
 *
 * Truth principle: when the underlying value is unknown / loading,
 * caller MUST pass `null` and the component should render the muted
 * neutral treatment with a "—" instead of guessing healthy.
 */
export function statusClasses(
  level: StatusLevel,
  variant: "soft" | "solid" | "outline" | "text" = "soft",
): string {
  const table: Record<StatusLevel, Record<typeof variant, string>> = {
    healthy: {
      soft: "bg-emerald-50 text-emerald-700 border-emerald-200",
      solid: "bg-emerald-600 text-white border-emerald-700",
      outline: "border-emerald-300 text-emerald-700",
      text: "text-emerald-600",
    },
    warning: {
      soft: "bg-amber-50 text-amber-700 border-amber-200",
      solid: "bg-amber-600 text-white border-amber-700",
      outline: "border-amber-300 text-amber-700",
      text: "text-amber-600",
    },
    critical: {
      soft: "bg-red-50 text-red-700 border-red-200",
      solid: "bg-red-600 text-white border-red-700",
      outline: "border-red-300 text-red-700",
      text: "text-red-600",
    },
    neutral: {
      soft: "bg-slate-100 text-slate-700 border-slate-200",
      solid: "bg-slate-600 text-white border-slate-700",
      outline: "border-slate-300 text-slate-700",
      text: "text-slate-600",
    },
  };
  return table[level][variant];
}

/**
 * Resolve a free-text status string (from a DB enum, an API
 * response, or a hard-coded literal) to a canonical StatusLevel.
 *
 * The mapping is intentionally narrow: anything we haven't
 * explicitly mapped collapses to `neutral`. That's a deliberate
 * "truth" choice — better a muted slate badge than a confident
 * green/red guess.
 *
 * If you need to add a new status, edit this map AND consider
 * whether the underlying enum should be normalised upstream.
 */
const STATUS_MAP: Record<string, StatusLevel> = {
  // Healthy — done / accepted / on-track / paid / approved.
  approved: "healthy",
  accepted: "healthy",
  complete: "healthy",
  completed: "healthy",
  done: "healthy",
  paid: "healthy",
  in_bank: "healthy",
  pass: "healthy",
  passed: "healthy",
  signed: "healthy",
  closed: "healthy",
  released: "healthy",
  confirmed: "healthy",
  // Warning — at-risk / pending / planned / submitted / loaded.
  warning: "warning",
  at_risk: "warning",
  pending: "warning",
  pending_review: "warning",
  in_review: "warning",
  submitted: "warning",
  draft: "warning",
  requires_info: "warning",
  loaded_for_payment: "warning",
  proof_attached: "warning",
  in_progress: "warning",
  planned: "warning",
  scheduled: "warning",
  invoiced: "warning",
  ordered: "warning",
  partially_received: "warning",
  received: "warning",
  open: "warning",
  // Critical — overdue / blocked / rejected / failed.
  overdue: "critical",
  blocked: "critical",
  rejected: "critical",
  fail: "critical",
  failed: "critical",
  cancelled: "critical",
  on_hold: "critical",
  // Neutral — initial / not-applicable / unknown.
  new: "neutral",
  not_started: "neutral",
  not_applicable: "neutral",
  na: "neutral",
  unknown: "neutral",
  archived: "neutral",
  internal: "neutral",
  tbc: "neutral",
};

/**
 * Resolve any status string to a StatusLevel. Case-insensitive,
 * snake_case or kebab-case tolerated. Returns "neutral" for
 * unknown values — never throws, never guesses.
 */
export function statusLevel(status?: string | null): StatusLevel {
  if (!status) return "neutral";
  const key = String(status).trim().toLowerCase().replace(/-/g, "_");
  return STATUS_MAP[key] ?? "neutral";
}

/**
 * Convenience: returns the soft-variant classes for a status.
 * Most badges across the app should use this single helper rather
 * than picking colours inline.
 */
export function statusBadgeClasses(status?: string | null): string {
  return statusClasses(statusLevel(status), "soft");
}

/**
 * RAG dot/badge classes for the three project-health flags.
 * Maps the existing "GREEN / AMBER / RED" enum to canonical
 * StatusLevels. `null` / unknown renders neutral.
 */
export function ragLevel(rag?: string | null): StatusLevel {
  if (!rag) return "neutral";
  const k = rag.trim().toUpperCase();
  if (k === "GREEN") return "healthy";
  if (k === "AMBER" || k === "YELLOW") return "warning";
  if (k === "RED") return "critical";
  return "neutral";
}

/**
 * Typography scale. The audit found 8+ active font sizes; we
 * lock to three. Call these from components rather than hard-
 * coding `text-xs`, `text-[11px]`, `text-2xl` etc.
 *
 * - PAGE_TITLE  — top-of-screen H1 (24px). One per page.
 * - SECTION     — group headers / card titles (16px). One per
 *                 visual region.
 * - BODY        — everything else (13–14px). Includes table cells,
 *                 KPI tile labels, body copy.
 *
 * Smaller "micro" labels (10–11px) are reserved for monospace
 * timestamps and ARIA-only metadata; do NOT use them for
 * primary information.
 */
export const TYPOGRAPHY = {
  PAGE_TITLE: "text-2xl font-semibold tracking-tight",
  SECTION: "text-base font-medium",
  BODY: "text-sm",
} as const;

/**
 * Density constants. Captured so layouts can stay consistent
 * across pages. Tailwind classes already encode these but a
 * single source-of-truth makes the rule explicit.
 */
export const DENSITY = {
  /** Minimum table row height — gives every row breathing room. */
  ROW_HEIGHT_PX: 40,
  /** Spacing between sibling cards / KPI tiles. */
  GAP_CLASS: "gap-4",
  /** Padding inside cards / collapsible sections. */
  CARD_PADDING_CLASS: "p-4",
  /** Maximum KPI tiles visible above the fold before progressive
   *  disclosure kicks in. */
  MAX_KPI_TILES_VISIBLE: 5,
  /** Maximum badges per table row. Past this the row enters
   *  badge-soup territory and the surplus should collapse into
   *  a tooltip or "⋮" menu. */
  MAX_BADGES_PER_ROW: 2,
} as const;
