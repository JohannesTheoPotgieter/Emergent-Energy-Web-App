import * as React from "react"
import { cn } from "@/lib/utils"

export interface MetricItem {
  label: string
  value: string | number
  change?: string
  trend?: "up" | "down" | "neutral"
  icon?: React.ReactNode
}

export interface MetricStripProps extends React.HTMLAttributes<HTMLDivElement> {
  metrics: MetricItem[]
}

function MetricStrip({ metrics, className, ...props }: MetricStripProps) {
  return (
    <div
      data-testid="metric-strip"
      className={cn(
        "grid gap-3",
        metrics.length <= 2 && "grid-cols-2",
        metrics.length === 3 && "grid-cols-2 sm:grid-cols-3",
        metrics.length === 4 && "grid-cols-2 sm:grid-cols-4",
        metrics.length >= 5 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
        className
      )}
      {...props}
    >
      {metrics.map((metric, i) => (
        <div
          key={i}
          data-testid={`metric-item-${i}`}
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors"
        >
          {metric.icon && (
            <div className="flex items-center justify-center h-9 w-9 rounded-md bg-primary/10 text-primary shrink-0">
              {metric.icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground truncate">
              {metric.label}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold text-foreground tabular-nums">
                {metric.value}
              </span>
              {metric.change && (
                <span
                  data-testid={`metric-change-${i}`}
                  className={cn(
                    "text-xs font-medium",
                    metric.trend === "up" && "text-green-600",
                    metric.trend === "down" && "text-red-600",
                    metric.trend === "neutral" && "text-muted-foreground"
                  )}
                >
                  {metric.change}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export { MetricStrip }
