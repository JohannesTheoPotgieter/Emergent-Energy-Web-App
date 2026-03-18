import * as React from "react";
import { cn } from "@/lib/utils";
import { FolderOpen } from "lucide-react";

/**
 * Standardised empty-state placeholder for lists, tables, and panels.
 * Renders a dashed-border box with an icon, title, and optional description.
 *
 * Usage:
 *   <EmptyState title="No projects match current filters" />
 *   <EmptyState icon={<Inbox />} title="Nothing here yet" description="Items will appear when data is imported." />
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-dashed border-border/60 p-6 text-center", className)}>
      <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center mx-auto mb-3">
        {icon || <FolderOpen className="w-6 h-6 text-muted-foreground" />}
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/60 mt-1">{description}</p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
