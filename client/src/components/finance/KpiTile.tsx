/**
 * Visual redesign foundation — KpiTile.
 *
 * Minimal KPI tile for the redesigned finance pages. One label, one
 * value, one supporting line, optional progress bar. No gradient, no
 * shadow. The whole tile is clickable when `onClick` is supplied
 * (rendered as a real <button> for keyboard / a11y).
 *
 * Optional slots — only render when supplied, so the default stays
 * minimal:
 *   - `icon`        a small lucide icon to the left of the label
 *   - `description` a sub-label under the label (smaller, grey)
 *   - `sourceBadge` a small badge in the top-right (e.g. "QB" / "App")
 *   - `delta`       a "vs. last mo. R X (▲ +4.5%)" footer
 *
 *   <KpiTile
 *     label="Inflows YTD"
 *     value={<Money value={kpis.inflows} />}
 *     valueAriaLabel={formatZarAriaLabel(kpis.inflows)}
 *     supporting="62% of FY plan"
 *     progress={{ pct: 62, tone: "positive" }}
 *     onClick={() => navigate("/cashflow/analysis")}
 *   />
 *
 *   <KpiTile
 *     label="YTD Realised"
 *     value={<Money value={ytdRealised} />}
 *     icon={<TrendingUp className="h-4 w-4" />}
 *     sourceBadge="canonical"
 *     delta={{
 *       label: "Last mo.",
 *       priorValue: <Money value={lastMonthValue} />,
 *       pct: 4.5,
 *       positiveIs: "good",
 *     }}
 *   />
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type KpiTileTone = "default" | "positive" | "warning" | "critical";

const VALUE_TONE: Record<KpiTileTone, string> = {
  default: "text-slate-900",
  positive: "text-emerald-700",
  warning: "text-amber-700",
  critical: "text-rose-700",
};

const PROGRESS_TONE: Record<KpiTileTone, string> = {
  default: "bg-slate-700",
  positive: "bg-emerald-600",
  warning: "bg-amber-600",
  critical: "bg-rose-600",
};

export interface KpiTileDelta {
  /** Prefix label — "Last mo." / "vs. plan" / etc. */
  label: React.ReactNode;
  /** Headline figure for the prior period (rendered alongside the delta). */
  priorValue?: React.ReactNode;
  /** Signed % change. Sign drives the arrow direction. */
  pct?: number;
  /** Semantic colouring: 'good' → +ve emerald / 'bad' → +ve rose. Default 'good'. */
  positiveIs?: "good" | "bad" | "neutral";
}

/**
 * Optional sparkline slot rendered on the right of the delta footer.
 * Caller supplies any JSX — typically a recharts ResponsiveContainer
 * with a LineChart sized to ~36 × 96 px. Keeping this as a freeform
 * ReactNode (instead of accepting a data array + colour) avoids pulling
 * recharts into the KpiTile component itself.
 */
export interface KpiTileSparkline {
  content: React.ReactNode;
  /** Tailwind width class — default w-28. Pages with denser layouts may pick a smaller width. */
  widthClass?: string;
}

export interface KpiTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Aria-label for the value element (e.g. formatZarAriaLabel output). */
  valueAriaLabel?: string;
  /** Supporting one-liner — "62% of FY plan", "12 invoices · 1 disputed". */
  supporting?: React.ReactNode;
  /** Tone for the value text + progress bar fill. */
  tone?: KpiTileTone;
  /** Optional progress bar — pct in 0-100. */
  progress?: { pct: number; tone?: KpiTileTone };
  /** Optional sub-label under the label (smaller, secondary). */
  description?: React.ReactNode;
  /** Optional small icon to the left of the label. */
  icon?: React.ReactNode;
  /** Optional source / provenance badge in the top-right. */
  sourceBadge?: React.ReactNode;
  /** Optional MoM-style delta footer (vs. last mo / vs. plan). */
  delta?: KpiTileDelta;
  /** Optional sparkline beside the delta footer — caller-supplied JSX. */
  sparkline?: KpiTileSparkline;
  /** Optional click handler — makes the tile a button. */
  onClick?: () => void;
  /** Optional href — makes the tile an anchor (when onClick is absent). */
  href?: string;
  className?: string;
  "data-testid"?: string;
}

function deltaTone(positiveIs: "good" | "bad" | "neutral", pct: number): string {
  if (positiveIs === "neutral" || pct === 0) return "text-slate-500";
  if (positiveIs === "good") return pct > 0 ? "text-emerald-700" : "text-rose-600";
  return pct > 0 ? "text-rose-600" : "text-emerald-700";
}

export function KpiTile({
  label,
  value,
  valueAriaLabel,
  supporting,
  tone = "default",
  progress,
  description,
  icon,
  sourceBadge,
  delta,
  sparkline,
  onClick,
  href,
  className,
  "data-testid": testId,
}: KpiTileProps) {
  const isInteractive = typeof onClick === "function" || !!href;
  const base = "block rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors";
  const interactive = isInteractive
    ? "hover:border-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 cursor-pointer"
    : "";

  const inner = (
    <>
      <div className="flex items-start gap-2">
        {icon && (
          <span className="shrink-0 h-7 w-7 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium leading-tight">{label}</p>
          {description && (
            <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{description}</p>
          )}
        </div>
        {sourceBadge && (
          <span
            className="shrink-0 inline-flex items-center text-[9px] font-medium px-1.5 py-0 rounded border border-slate-200 bg-white text-slate-500"
            data-testid="kpi-tile-source-badge"
          >
            {sourceBadge}
          </span>
        )}
      </div>
      <p
        className={cn("mt-2 text-2xl font-bold tabular-nums leading-tight", VALUE_TONE[tone])}
        {...(valueAriaLabel ? { "aria-label": valueAriaLabel } : {})}
      >
        {value}
      </p>
      {supporting && <p className="text-[11px] text-slate-500 mt-0.5">{supporting}</p>}
      {progress && (
        <div className="mt-2 h-1.5 bg-slate-100 rounded">
          <div
            className={cn("h-1.5 rounded", PROGRESS_TONE[progress.tone ?? tone])}
            style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
          />
        </div>
      )}
      {(delta || sparkline) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {delta ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-500 min-w-0 flex-1">
              <span className="shrink-0">{delta.label}</span>
              {delta.priorValue !== undefined && (
                <span className="font-mono font-semibold text-slate-700 truncate">{delta.priorValue}</span>
              )}
              {delta.pct !== undefined && Number.isFinite(delta.pct) && (
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center gap-0.5 font-medium",
                    deltaTone(delta.positiveIs ?? "good", delta.pct),
                  )}
                  aria-label={delta.pct > 0 ? "increase" : delta.pct < 0 ? "decrease" : "no change"}
                >
                  <span aria-hidden="true">{delta.pct > 0 ? "▲" : delta.pct < 0 ? "▼" : "·"}</span>
                  {Math.abs(delta.pct).toFixed(1)}%
                </span>
              )}
            </div>
          ) : (
            <span className="flex-1" />
          )}
          {sparkline && (
            <div className={cn("h-9 shrink-0", sparkline.widthClass ?? "w-28")} data-testid="kpi-tile-sparkline">
              {sparkline.content}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (typeof onClick === "function") {
    return (
      <button
        type="button"
        className={cn(base, interactive, "w-full", className)}
        onClick={onClick}
        data-testid={testId}
      >
        {inner}
      </button>
    );
  }
  if (href) {
    return (
      <a className={cn(base, interactive, className)} href={href} data-testid={testId}>
        {inner}
      </a>
    );
  }
  return (
    <div className={cn(base, className)} data-testid={testId}>
      {inner}
    </div>
  );
}
