import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * TableLayout — canonical W3 List archetype composition.
 *
 * Additive Phase 1 primitive. Composes the existing Table primitive with a
 * toolbar, active-filter chip row, and optional sticky bulk-action bar.
 *
 * Contract (docs/overhaul/01-design-system.md §3 L5, wireframe W3):
 *   - toolbar: search + filters + view toggle (caller-composed)
 *   - activeFilters: chip row shown below toolbar when filters are active
 *   - table: the actual <Table> content (caller-composed)
 *   - pagination: typically a <TablePagination> instance
 *   - bulkActions: optional node shown in the sticky bottom bar when
 *     `selectedCount > 0`
 *
 * The primitive owns layout; the caller owns data.
 */

export interface TableLayoutProps {
  /** Top toolbar — typically search + filter dropdowns + view toggle. */
  toolbar?: React.ReactNode;
  /**
   * Active-filter chip row. Pass an array of chip nodes or a full rendered
   * row. When omitted or empty the row is not rendered.
   */
  activeFilters?: React.ReactNode;
  /** Table body — pass the composed <Table>...</Table>. */
  table: React.ReactNode;
  /** Optional pagination footer — typically <TablePagination />. */
  pagination?: React.ReactNode;
  /**
   * Bulk-action bar — rendered sticky-bottom when selectedCount > 0.
   * Pass the action buttons; the primitive wraps them in the bar chrome.
   */
  bulkActions?: React.ReactNode;
  /** Number of currently selected rows. Controls bulk-action bar visibility. */
  selectedCount?: number;
  /** Called when the user presses "Clear" in the bulk-action bar. */
  onClearSelection?: () => void;
  /** Optional label to describe the bulk-action bar selection, e.g. "2 selected". */
  bulkSelectionLabel?: string;
  /** Additional className for the root wrapper. */
  className?: string;
}

export function TableLayout({
  toolbar,
  activeFilters,
  table,
  pagination,
  bulkActions,
  selectedCount = 0,
  onClearSelection,
  bulkSelectionLabel,
  className,
}: TableLayoutProps) {
  const hasSelection = selectedCount > 0 && !!bulkActions;

  return (
    <div
      data-testid="table-layout"
      className={cn("flex flex-col gap-3 relative", className)}
    >
      {toolbar && (
        <div
          data-testid="table-layout-toolbar"
          className="flex flex-wrap items-center gap-2 sticky top-0 z-[5] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 py-2"
        >
          {toolbar}
        </div>
      )}

      {activeFilters && (
        <div
          data-testid="table-layout-active-filters"
          className="flex flex-wrap items-center gap-2"
        >
          {activeFilters}
        </div>
      )}

      <div data-testid="table-layout-table" className="min-w-0 overflow-x-auto">
        {table}
      </div>

      {pagination && (
        <div
          data-testid="table-layout-pagination"
          className="flex items-center justify-end pt-2"
        >
          {pagination}
        </div>
      )}

      {hasSelection && (
        <div
          data-testid="table-layout-bulk-action-bar"
          role="toolbar"
          aria-label="Bulk actions"
          className={cn(
            "sticky bottom-4 z-[50] mx-auto w-fit max-w-[calc(100%-2rem)]",
            "flex items-center gap-3 rounded-lg border border-border",
            "bg-background px-4 py-2 shadow-[var(--shadow-md)]",
            "animate-slide-up-fade",
          )}
        >
          <span
            data-testid="table-layout-bulk-selection-label"
            className="text-sm font-medium"
          >
            {bulkSelectionLabel ?? `${selectedCount} selected`}
          </span>
          <div className="flex items-center gap-1">{bulkActions}</div>
          {onClearSelection && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearSelection}
              aria-label="Clear selection"
              data-testid="table-layout-bulk-clear"
              className="gap-1"
            >
              <X className="h-3.5 w-3.5" />
              <span>Clear</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
