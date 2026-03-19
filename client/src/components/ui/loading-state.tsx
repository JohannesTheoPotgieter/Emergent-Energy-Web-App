import * as React from "react";
import { cn } from "@/lib/utils";
import { EnergyLoader } from "./energy-loader";
import { Skeleton } from "./skeleton";

export type LoadingVariant = "page" | "section" | "inline" | "skeleton-card" | "skeleton-table" | "skeleton-chart";

export interface LoadingStateProps {
  /** Which visual style to use */
  variant?: LoadingVariant;
  /** Optional label describing what's loading */
  label?: string;
  /** Additional className */
  className?: string;
  /** Number of skeleton rows for skeleton-table variant */
  rows?: number;
  /** Number of skeleton cards for skeleton-card variant */
  cards?: number;
}

/** Unified loading state component — replaces scattered Loader2, EnergyLoader, and custom skeletons */
export function LoadingState({
  variant = "section",
  label,
  className,
  rows = 5,
  cards = 4,
}: LoadingStateProps) {
  switch (variant) {
    case "page":
      return (
        <div className={cn("flex items-center justify-center min-h-[400px] w-full", className)}>
          <EnergyLoader size="lg" label={label || "Loading..."} />
        </div>
      );

    case "section":
      return (
        <div className={cn("flex flex-col items-center justify-center py-12 gap-3", className)}>
          <EnergyLoader size="md" label={label} />
        </div>
      );

    case "inline":
      return (
        <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
          <EnergyLoader size="sm" />
          {label && <span>{label}</span>}
        </div>
      );

    case "skeleton-card":
      return (
        <div className={cn("grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4", className)}>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/50 p-3.5">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      );

    case "skeleton-table":
      return (
        <div className={cn("space-y-2", className)}>
          {/* Header */}
          <div className="flex gap-4 px-3 py-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          {/* Rows */}
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-4 px-3 py-2.5 border-b border-border/30">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      );

    case "skeleton-chart":
      return (
        <div className={cn("rounded-lg border border-border/50 p-4", className)}>
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="flex items-end gap-1 h-[200px]">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1 rounded-t"
                style={{ height: `${30 + Math.random() * 60}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2">
            {["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"].map((m) => (
              <Skeleton key={m} className="h-3 w-6" />
            ))}
          </div>
        </div>
      );
  }
}
