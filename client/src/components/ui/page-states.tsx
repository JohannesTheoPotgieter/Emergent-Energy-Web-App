/**
 * A8: Standardized loading and empty state components.
 *
 * PageSkeleton — shows a header skeleton + content skeleton while data loads.
 * PageEmpty — shows an icon + message + optional action when a list is empty.
 */
import { Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// ===================== PAGE SKELETON =====================

export function PageSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div className="space-y-6 animate-pulse p-4 md:p-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-6 w-56 bg-muted rounded" />
        <div className="h-3 w-72 bg-muted rounded" />
      </div>

      {/* KPI strip skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-20 bg-muted rounded-lg" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ===================== PAGE LOADING SPINNER =====================

export function PageLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin mb-3" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ===================== PAGE EMPTY STATE =====================

interface PageEmptyProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
}

export function PageEmpty({ icon: Icon, title, description, actionLabel, onAction, actionHref }: PageEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && <Icon className="h-12 w-12 text-muted-foreground/40 mb-4" />}
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>}
      {actionLabel && onAction && (
        <Button onClick={onAction} size="sm">
          {actionLabel}
        </Button>
      )}
      {actionLabel && actionHref && !onAction && (
        <Button asChild size="sm">
          <a href={actionHref}>{actionLabel}</a>
        </Button>
      )}
    </div>
  );
}

// ===================== PAGE ERROR STATE =====================

interface PageErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function PageError({ title = "Something went wrong", message, onRetry }: PageErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <span className="text-destructive text-lg font-bold">!</span>
      </div>
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      {message && <p className="text-sm text-muted-foreground max-w-md mb-4">{message}</p>}
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm">
          Try again
        </Button>
      )}
    </div>
  );
}
