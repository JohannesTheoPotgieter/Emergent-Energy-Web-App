import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Database, FlaskConical, Pencil } from "lucide-react";
import type { FinanceTrustMeta, FinanceSourceLayer } from "@/lib/finance-trust";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";

function layerIcon(layer: FinanceSourceLayer) {
  switch (layer) {
    case "canonical":
      return CheckCircle2;
    case "derived":
      return Database;
    case "cache":
      return Clock;
    case "legacy":
      return FlaskConical;
    case "override":
      return Pencil;
  }
}

function layerVariant(layer: FinanceSourceLayer): Variant {
  switch (layer) {
    case "canonical":
      return "success";
    case "derived":
      return "info";
    case "cache":
      return "secondary";
    case "legacy":
      return "warning";
    case "override":
      return "warning";
  }
}

function layerLabel(layer: FinanceSourceLayer): string {
  switch (layer) {
    case "canonical":
      return "Canonical";
    case "derived":
      return "Derived";
    case "cache":
      return "Cache";
    case "legacy":
      return "Legacy";
    case "override":
      return "Override";
  }
}

function formatRefreshed(refreshedAt: string | null): string | null {
  if (!refreshedAt) return null;
  const d = new Date(refreshedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

function computeAgeSeconds(refreshedAt: string | null, now: number): number | null {
  if (!refreshedAt) return null;
  const d = new Date(refreshedAt);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now - d.getTime()) / 1000));
}

function describeAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export interface DataTrustBadgeProps {
  trust: FinanceTrustMeta | null;
  /** Show nothing when trust metadata is unavailable. Default true. */
  hideWhenMissing?: boolean;
  className?: string;
}

/**
 * Displays the finance trust envelope for the response that produced the
 * numbers on the page — source layer, last refresh age, staleness, overrides,
 * exception count, and any uncertainty signal.
 *
 * Always visible per product decision: users get a small pill they can hover
 * for the full provenance breakdown.
 */
export function DataTrustBadge({ trust, hideWhenMissing = true, className }: DataTrustBadgeProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!trust) {
    if (hideWhenMissing) return null;
    return (
      <Badge variant="outline" className={cn("gap-1", className)} data-testid="data-trust-badge-missing">
        <AlertTriangle className="h-3 w-3" />
        Trust unknown
      </Badge>
    );
  }

  const Icon = layerIcon(trust.sourceLayer);
  const ageSeconds = computeAgeSeconds(trust.refreshedAt, now);
  const stale =
    ageSeconds !== null &&
    trust.staleAfterSeconds !== null &&
    ageSeconds > trust.staleAfterSeconds;

  let variant: Variant = layerVariant(trust.sourceLayer);
  if (stale || trust.uncertainty) variant = "warning";
  if (trust.exceptionCount && trust.exceptionCount > 0) {
    variant = variant === "warning" ? "destructive" : "warning";
  }

  const label = layerLabel(trust.sourceLayer);
  const refreshedDisplay = formatRefreshed(trust.refreshedAt);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn("inline-flex", className)}
            data-testid="data-trust-badge"
            data-source-layer={trust.sourceLayer}
            data-stale={stale ? "true" : "false"}
            data-override={trust.overrideInEffect ? "true" : "false"}
          >
            <Badge variant={variant} className="gap-1">
              <Icon className="h-3 w-3" />
              <span>{label}</span>
              {ageSeconds !== null && <span className="opacity-75">· {describeAge(ageSeconds)}</span>}
              {trust.overrideInEffect && <span className="opacity-75">· override</span>}
              {trust.exceptionCount && trust.exceptionCount > 0 ? (
                <span className="opacity-75">· {trust.exceptionCount} issue{trust.exceptionCount === 1 ? "" : "s"}</span>
              ) : null}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
          <div className="space-y-1">
            <div className="font-semibold">Data trust</div>
            <div>
              <span className="font-medium">Source:</span> {label}
              {trust.canonicalTable ? ` (${trust.canonicalTable})` : ""}
            </div>
            {trust.derivedTable && (
              <div>
                <span className="font-medium">Derived:</span> {trust.derivedTable}
              </div>
            )}
            {trust.cacheLayer && (
              <div>
                <span className="font-medium">Cache:</span> {trust.cacheLayer}
              </div>
            )}
            {refreshedDisplay && (
              <div>
                <span className="font-medium">Refreshed:</span> {refreshedDisplay}
              </div>
            )}
            {trust.staleAfterSeconds !== null && (
              <div>
                <span className="font-medium">Stale after:</span> {trust.staleAfterSeconds}s
                {stale ? " — currently stale" : ""}
              </div>
            )}
            {trust.uncertainty && (
              <div className="text-amber-700">
                <span className="font-medium">Warning:</span> {trust.uncertainty.replace(/_/g, " ")}
              </div>
            )}
            {trust.overrideInEffect && (
              <div>
                <span className="font-medium">Override:</span> in effect
              </div>
            )}
            {trust.exceptionCount !== null && trust.exceptionCount > 0 && (
              <div>
                <span className="font-medium">Exceptions:</span> {trust.exceptionCount}
              </div>
            )}
            {trust.featureFlag && (
              <div className="text-muted-foreground">
                <span className="font-medium">Flag:</span> {trust.featureFlag.name}={trust.featureFlag.enabled ? "on" : "off"}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
