import * as React from "react"
import { ChevronRight } from "lucide-react"
import { Link } from "wouter"
import { cn } from "@/lib/utils"

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  subtitle?: string
  breadcrumbs?: BreadcrumbItem[]
  actions?: React.ReactNode
  filters?: React.ReactNode
}

function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  filters,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      data-testid="page-header"
      className={cn(
        "flex flex-col gap-3 pb-4 border-b border-border",
        className
      )}
      {...props}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="breadcrumb"
          data-testid="page-header-breadcrumbs"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1
            data-testid="page-header-title"
            className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
          >
            {title}
          </h1>
          {subtitle && (
            <p
              data-testid="page-header-subtitle"
              className="text-sm text-muted-foreground"
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div
            data-testid="page-header-actions"
            className="flex items-center gap-2 shrink-0"
          >
            {actions}
          </div>
        )}
      </div>

      {filters && (
        <div
          data-testid="page-header-filters"
          className="flex flex-wrap items-center gap-2"
        >
          {filters}
        </div>
      )}
    </div>
  )
}

export { PageHeader }
