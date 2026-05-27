/**
 * TF-19 (audit V3) — Drill-down reconciliation indicator.
 *
 * When a user clicks a dashboard tile that says "Revenue: R 5M" and
 * lands on a drilldown whose rows sum to R 4.9M, the discrepancy is
 * easy to miss. This footer pins the source vs. drilldown totals
 * together and surfaces the delta + a "reconciles" / "off by R X"
 * status badge.
 *
 * Drop into any drilldown table that has a known parent figure:
 *
 *   <DrillReconciliationFooter
 *     sourceLabel="Dashboard tile"
 *     sourceValue={parentTileTotal}
 *     drilldownLabel={`${rows.length} line items`}
 *     drilldownValue={rows.reduce((s, r) => s + r.amount, 0)}
 *   />
 */
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Money } from "@/components/ui/money";
import { formatZar } from "@/lib/currency";

export interface DrillReconciliationFooterProps {
  sourceLabel: string;
  sourceValue: number | null | undefined;
  drilldownLabel: string;
  drilldownValue: number;
  /**
   * Absolute tolerance below which the totals are considered "reconciled".
   * Default R 1 (covers en-ZA rounding artefacts).
   */
  tolerance?: number;
  className?: string;
}

export function DrillReconciliationFooter({
  sourceLabel,
  sourceValue,
  drilldownLabel,
  drilldownValue,
  tolerance = 1,
  className,
}: DrillReconciliationFooterProps) {
  const source = typeof sourceValue === "number" && Number.isFinite(sourceValue) ? sourceValue : null;
  const delta = source === null ? null : drilldownValue - source;
  const reconciles = delta !== null && Math.abs(delta) <= tolerance;

  return (
    <div
      className={
        "flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 bg-muted/30 text-sm " +
        (className ?? "")
      }
      data-testid="drill-reconciliation-footer"
    >
      <div className="flex items-center gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {sourceLabel}
          </p>
          {source === null ? (
            <span className="font-mono font-semibold text-muted-foreground">—</span>
          ) : (
            <Money className="font-mono font-semibold" value={source} />
          )}
        </div>
        <span className="text-muted-foreground">vs.</span>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {drilldownLabel}
          </p>
          <Money className="font-mono font-semibold" value={drilldownValue} />
        </div>
      </div>
      {source !== null && (
        <div className="flex items-center gap-2" data-testid="drill-reconciliation-status">
          {reconciles ? (
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="w-3 h-3" /> Reconciles
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800" title={`Delta: ${formatZar(delta ?? 0)}`}>
              <AlertTriangle className="w-3 h-3" /> Off by{" "}
              <Money value={Math.abs(delta ?? 0)} />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
