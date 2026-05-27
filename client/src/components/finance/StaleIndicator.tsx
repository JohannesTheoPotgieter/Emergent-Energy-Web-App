/**
 * TF-32 (audit V3) — Tiny "last refreshed N min ago" indicator.
 *
 * TanStack Query exposes `dataUpdatedAt` for every query but no finance
 * page renders it. Operators can't tell whether the number they're
 * looking at is 30 seconds old or 30 minutes old. Drop this beside the
 * KPI tile group or the page header:
 *
 *   <StaleIndicator updatedAt={query.dataUpdatedAt} staleAfterMs={5*60_000} />
 *
 * The component grades into three states:
 *   < staleAfterMs/2          neutral (silent)
 *   >= staleAfterMs/2         info ("Updated 3 min ago")
 *   >= staleAfterMs           warning ("Stale — last updated 12 min ago")
 */
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle } from "lucide-react";

export interface StaleIndicatorProps {
  /** Epoch ms or null/undefined for "never refreshed". */
  updatedAt: number | null | undefined;
  /** Cut-off after which the data counts as stale. Default 5 min. */
  staleAfterMs?: number;
  className?: string;
}

function relativeMinutes(ms: number): string {
  if (ms < 60_000) return "<1 min";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return `${hours} h`;
}

export function StaleIndicator({
  updatedAt,
  staleAfterMs = 5 * 60_000,
  className,
}: StaleIndicatorProps) {
  if (!updatedAt) {
    return (
      <Badge variant="outline" className={`gap-1 text-xs text-muted-foreground ${className ?? ""}`}>
        <Clock className="w-3 h-3" /> Never refreshed
      </Badge>
    );
  }
  const ageMs = Date.now() - updatedAt;
  if (ageMs < staleAfterMs / 2) return null;
  if (ageMs >= staleAfterMs) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 text-xs border-amber-200 bg-amber-50 text-amber-800 ${className ?? ""}`}
        data-testid="indicator-stale"
      >
        <AlertTriangle className="w-3 h-3" /> Stale — last updated {relativeMinutes(ageMs)} ago
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-xs text-muted-foreground ${className ?? ""}`}
      data-testid="indicator-fresh"
    >
      <Clock className="w-3 h-3" /> Updated {relativeMinutes(ageMs)} ago
    </Badge>
  );
}
