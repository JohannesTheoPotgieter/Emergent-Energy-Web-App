import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const statusChipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap select-none transition-colors",
  {
    variants: {
      status: {
        success: "bg-green-50 text-green-700 border border-green-200",
        warning: "bg-amber-50 text-amber-700 border border-amber-200",
        error: "bg-red-50 text-red-700 border border-red-200",
        info: "bg-blue-50 text-blue-700 border border-blue-200",
        neutral: "bg-muted text-muted-foreground border border-border",
        active: "bg-green-50 text-green-700 border border-green-200",
      },
      size: {
        sm: "text-[10px] px-2 py-px",
        default: "text-xs px-2.5 py-0.5",
        lg: "text-sm px-3 py-1",
      },
    },
    defaultVariants: {
      status: "neutral",
      size: "default",
    },
  }
)

export interface StatusChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusChipVariants> {
  dot?: boolean
  icon?: React.ReactNode
}

function StatusChip({
  className,
  status,
  size,
  dot = false,
  icon,
  children,
  ...props
}: StatusChipProps) {
  return (
    <span
      data-testid="status-chip"
      className={cn(statusChipVariants({ status, size }), className)}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            status === "success" && "bg-green-500",
            status === "warning" && "bg-amber-500",
            status === "error" && "bg-red-500",
            status === "info" && "bg-blue-500",
            status === "neutral" && "bg-muted-foreground",
            status === "active" && "bg-green-600"
          )}
        />
      )}
      {icon && <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  )
}

export { StatusChip, statusChipVariants }
