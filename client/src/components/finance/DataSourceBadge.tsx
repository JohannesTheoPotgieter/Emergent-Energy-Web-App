/**
 * EE-QA-022 — visible row-level data-origin badge for finance tables.
 *
 * Finance tables (COS, cashflow, revenue tracker) mix four very different
 * data origins:
 *   - "imported"        — landed from a Smart Import v2 baseline; never edited.
 *   - "imported_edited" — landed from import, then edited in-app.
 *   - "manual"          — typed in the app, no import lineage.
 *   - "override"        — admin date / status override applied on top of either
 *                         import or manual baseline; treated as the most
 *                         authoritative origin label since it dictates what
 *                         the row currently shows.
 *
 * QB linkage is rendered separately by `<MatchStatusBadge>` (matched /
 * qb_only / app_only) — not collapsed into this badge — because a row can
 * be (e.g.) imported AND QB-linked.
 *
 * Inputs are deliberately string-shaped (not enums) because the wire types
 * vary slightly across the legacy `row_source` column and v2 `source`
 * column. Unknown / null values render as a neutral "?" with a tooltip so
 * the cell never silently lies.
 */
import { Pencil, Sparkles, FileSpreadsheet, AlertCircle, Wand2 } from "lucide-react";

export type DataSourceKind =
  | "imported"
  | "imported_edited"
  | "manual"
  | "override"
  | "unknown";

interface DataSourceBadgeProps {
  /** Wire value of `row_source` / `source` (e.g. 'imported', 'manual', 'imported_edited'). */
  source?: string | null;
  /**
   * When true, render the "Override" variant regardless of `source`. Use
   * this when an admin date / status override is present (e.g.
   * `cosStatusOverride !== null` or `adminDateOverride !== null`).
   */
  overridden?: boolean;
  /** Optional extra tooltip text shown alongside the canonical kind label. */
  detail?: string;
  /** For tests / data-attribute hooks. */
  testId?: string;
}

function resolveKind(source: string | null | undefined, overridden: boolean): DataSourceKind {
  if (overridden) return "override";
  if (!source) return "unknown";
  const s = source.toLowerCase();
  if (s === "imported") return "imported";
  if (s === "imported_edited") return "imported_edited";
  if (s === "manual") return "manual";
  return "unknown";
}

const STYLES: Record<DataSourceKind, string> = {
  imported: "bg-sky-50 text-sky-700 border-sky-200",
  imported_edited: "bg-amber-50 text-amber-700 border-amber-200",
  manual: "bg-violet-50 text-violet-700 border-violet-200",
  override: "bg-rose-50 text-rose-700 border-rose-200",
  unknown: "bg-muted text-muted-foreground border-border",
};

const LABELS: Record<DataSourceKind, string> = {
  imported: "Imported",
  imported_edited: "Imported · Edited",
  manual: "Manual",
  override: "Override",
  unknown: "?",
};

const TOOLTIPS: Record<DataSourceKind, string> = {
  imported: "Imported from a Smart Import v2 baseline; never edited in-app.",
  imported_edited: "Imported from a baseline and then edited in-app — the displayed value is no longer the imported value.",
  manual: "Typed directly into the app; no Smart Import lineage.",
  override: "An admin date or status override is applied on top of the underlying baseline. The override is what this row currently reflects.",
  unknown: "Data origin not reported by the API.",
};

const ICONS: Record<DataSourceKind, typeof Pencil> = {
  imported: FileSpreadsheet,
  imported_edited: Pencil,
  manual: Sparkles,
  override: Wand2,
  unknown: AlertCircle,
};

export function DataSourceBadge({ source, overridden = false, detail, testId }: DataSourceBadgeProps) {
  const kind = resolveKind(source, overridden);
  const Icon = ICONS[kind];
  const tooltip = detail ? `${TOOLTIPS[kind]} ${detail}` : TOOLTIPS[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STYLES[kind]}`}
      title={tooltip}
      data-testid={testId ?? `data-source-badge-${kind}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {LABELS[kind]}
    </span>
  );
}
