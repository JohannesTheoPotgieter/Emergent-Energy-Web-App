import * as React from "react";
import { cn } from "@/lib/utils";
import { ResponsiveContainer } from "recharts";
import { CHART_COLORS } from "@/lib/status-colors";
import { formatRand } from "@/lib/safeMoney";

export { CHART_COLORS };

/** Standard chart money formatter for axis ticks */
export function chartMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R${(v / 1_000).toFixed(0)}K`;
  return `R${v.toFixed(0)}`;
}

/** Standard chart tooltip money formatter */
export function chartTooltipMoney(v: number): string {
  return formatRand(v, { decimals: 0 });
}

/** Standard chart percentage formatter */
export function chartPercent(v: number): string {
  return `${v.toFixed(0)}%`;
}

export interface ResponsiveChartProps {
  /** Chart content (Area, Bar, Line, etc.) */
  children: React.ReactNode;
  /** Height in pixels — adapts on mobile */
  height?: number;
  /** Chart title */
  title?: string;
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * Responsive chart wrapper that provides consistent sizing, title placement,
 * and responsive behavior across all chart instances in the app.
 */
export function ResponsiveChart({
  children,
  height = 280,
  title,
  className,
}: ResponsiveChartProps) {
  return (
    <div className={cn("rounded-lg border border-border/50 overflow-hidden", className)}>
      {title && (
        <div className="px-4 pt-3 pb-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
        </div>
      )}
      <div className="px-2 pb-2" style={{ minHeight: Math.max(height * 0.6, 160) }}>
        <ResponsiveContainer width="100%" height={height}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Standard gradient definition for Recharts SVG defs — place inside chart */
export function ChartGradient({
  id,
  color,
  opacity = 0.3,
}: {
  id: string;
  color: string;
  opacity?: number;
}) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor={color} stopOpacity={opacity} />
      <stop offset="95%" stopColor={color} stopOpacity={0.05} />
    </linearGradient>
  );
}
