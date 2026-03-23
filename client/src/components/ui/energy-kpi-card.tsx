import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "./card";
import { Skeleton } from "./skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { Info } from "lucide-react";

export type RagStatus = "green" | "amber" | "red";

export interface EnergyKpiCardProps {
  /** Main value to display */
  value: string | number;
  /** Label below the value */
  label: string;
  /** Optional icon displayed before the label */
  icon?: React.ReactNode;
  /** RAG status indicator dot */
  rag?: RagStatus | null;
  /** Text color class for the value */
  color?: string;
  /** Loading state */
  loading?: boolean;
  /** Trend indicator: positive shows green arrow up, negative shows red arrow down */
  trend?: number | null;
  /** Tooltip explaining the KPI source/formula */
  traceability?: {
    source: string;
    formula?: string;
    endpoint?: string;
  };
  /** Test ID for e2e testing */
  testId?: string;
  /** Click handler */
  onClick?: () => void;
  /** Additional className */
  className?: string;
  /** Compact mode — less padding */
  compact?: boolean;
}

const RAG_DOT_CLASS: Record<RagStatus, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const RAG_RING_CLASS: Record<RagStatus, string> = {
  green: "ring-emerald-500/20",
  amber: "ring-amber-500/20",
  red: "ring-red-500/20",
};

export function EnergyKpiCard({
  value,
  label,
  icon,
  rag,
  color,
  loading,
  trend,
  traceability,
  testId,
  onClick,
  className,
  compact,
}: EnergyKpiCardProps) {
  const isClickable = !!onClick;

  return (
    <Card
      className={cn(
        "border-border/50 transition-colors",
        isClickable && "cursor-pointer hover:border-primary/30 hover:shadow-sm",
        className,
      )}
      onClick={onClick}
    >
      <CardContent className={cn("relative", compact ? "p-2.5" : "p-3.5")}>
        {/* RAG dot indicator */}
        {rag && (
          <div
            className={cn(
              "absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full ring-2",
              RAG_DOT_CLASS[rag],
              RAG_RING_CLASS[rag],
            )}
            title={`Status: ${rag}`}
          />
        )}

        {/* Icon + label row */}
        {(icon || label) && (
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            {icon}
            <span className="text-[11px] uppercase tracking-wide leading-none">{label}</span>
            {traceability && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    <p className="font-medium mb-1">Source: {traceability.source}</p>
                    {traceability.formula && (
                      <p className="text-muted-foreground">Formula: {traceability.formula}</p>
                    )}
                    {traceability.endpoint && (
                      <p className="text-muted-foreground font-mono text-[10px] mt-0.5">{traceability.endpoint}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}

        {/* Value */}
        {loading ? (
          <Skeleton className={cn(compact ? "h-5 w-16" : "h-7 w-20")} />
        ) : (
          <div className="flex items-baseline gap-1.5">
            <p
              className={cn(
                "font-semibold font-mono text-foreground",
                compact ? "text-base" : "text-xl",
                color,
              )}
              data-testid={testId}
            >
              {value}
            </p>
            {trend != null && trend !== 0 && (
              <span
                className={cn(
                  "text-[10px] font-medium",
                  trend > 0 ? "text-emerald-600" : "text-red-600",
                )}
              >
                {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Grid wrapper for a row of KPI cards */
export function KpiStrip({
  children,
  className,
  columns = 4,
}: {
  children: React.ReactNode;
  className?: string;
  columns?: 2 | 3 | 4 | 5 | 6;
}) {
  const colClass =
    columns === 2 ? "grid-cols-1 sm:grid-cols-2" :
    columns === 3 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" :
    columns === 5 ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" :
    columns === 6 ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" :
    "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  return (
    <div className={cn("grid gap-2", colClass, className)}>
      {children}
    </div>
  );
}
