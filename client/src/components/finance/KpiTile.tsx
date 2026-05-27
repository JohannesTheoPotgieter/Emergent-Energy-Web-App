/**
 * Visual redesign foundation — KpiTile.
 *
 * Minimal KPI tile for the redesigned finance pages. One label, one
 * value, one supporting line, optional progress bar. No icon tile, no
 * gradient, no shadow. The whole tile is clickable when `onClick` is
 * supplied (rendered as a real <button> for keyboard / a11y).
 *
 * Differs from the legacy `KpiCard` in `@/components/ui/kpi-card`:
 *   - No icon
 *   - No tone tiles (background stays white)
 *   - Built-in <Money> integration through the value prop is the
 *     caller's responsibility
 *   - Progress bar opt-in via `progress` prop
 *
 *   <KpiTile
 *     label="Inflows YTD"
 *     value={<Money value={kpis.inflows} />}
 *     valueAriaLabel={formatZarAriaLabel(kpis.inflows)}
 *     supporting="62% of FY plan"
 *     progress={{ pct: 62, tone: "positive" }}
 *     onClick={() => navigate("/cashflow/analysis")}
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
  /** Optional click handler — makes the tile a button. */
  onClick?: () => void;
  /** Optional href — makes the tile an anchor (when onClick is absent). */
  href?: string;
  className?: string;
  "data-testid"?: string;
}

export function KpiTile({
  label,
  value,
  valueAriaLabel,
  supporting,
  tone = "default",
  progress,
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
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
      <p
        className={cn("mt-1.5 text-2xl font-bold tabular-nums leading-tight", VALUE_TONE[tone])}
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
