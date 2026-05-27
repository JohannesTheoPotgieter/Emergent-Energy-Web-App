/**
 * Visual redesign foundation — DirectionDelta.
 *
 * Renders a delta (variance) with a ▲ / ▼ direction arrow + a colour
 * so colour-blind users read direction independently (TF-33). Used in
 * variance cells and KPI sub-lines across the redesigned finance pages.
 *
 *   <DirectionDelta value={124500} positiveIs="bad" /> // ▲ R 124 500 in rose
 *   <DirectionDelta value={-16000} positiveIs="bad" /> // ▼ R 16 000 in emerald
 *
 * `positiveIs` controls semantic colouring:
 *   - "bad":   positive variance is rose / negative is emerald (e.g. cost over plan)
 *   - "good":  positive variance is emerald / negative is rose (e.g. revenue over plan)
 *   - "neutral": no colouring, just direction arrow.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Money } from "@/components/ui/money";

export type DirectionSemantics = "bad" | "good" | "neutral";

export interface DirectionDeltaProps {
  /** Signed numeric delta. */
  value: number | null | undefined;
  /** What positive direction means semantically. Default "good". */
  positiveIs?: DirectionSemantics;
  /** Render the absolute value as money. Default true. */
  asMoney?: boolean;
  /** Show cents (passes through to Money). */
  cents?: boolean;
  /** Suffix to render after the value (e.g. "pp" for percentage points). */
  suffix?: React.ReactNode;
  className?: string;
}

function toneFor(value: number, positiveIs: DirectionSemantics): string {
  if (positiveIs === "neutral") return "text-slate-700";
  if (value === 0) return "text-slate-500";
  const positiveTone = positiveIs === "good" ? "text-emerald-700" : "text-rose-600";
  const negativeTone = positiveIs === "good" ? "text-rose-600" : "text-emerald-700";
  return value > 0 ? positiveTone : negativeTone;
}

export function DirectionDelta({
  value,
  positiveIs = "good",
  asMoney = true,
  cents,
  suffix,
  className,
}: DirectionDeltaProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("text-slate-400", className)}>—</span>;
  }
  const tone = toneFor(value, positiveIs);
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "·";
  const directionLabel = value > 0 ? "increase" : value < 0 ? "decrease" : "no change";
  const abs = Math.abs(value);
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", tone, className)}>
      <span aria-label={directionLabel}>{arrow}</span>
      {asMoney ? <Money value={abs} cents={cents} /> : <span>{abs.toLocaleString("en-ZA")}</span>}
      {suffix && <span className="text-[11px]">{suffix}</span>}
    </span>
  );
}
