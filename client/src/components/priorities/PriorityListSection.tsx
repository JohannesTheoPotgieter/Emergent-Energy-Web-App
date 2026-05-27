import { AlertCircle, AlertTriangle, Flag, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PriorityRow } from "@/lib/priority-types";
import { PriorityCard, type PriorityListDensity } from "./PriorityCard";

export interface PriorityListSectionProps {
  priorities: PriorityRow[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  /**
   * Either a list-wide boolean (legacy) or a per-row predicate. The predicate
   * lets owners/assignees see Escalate on role-scope priorities they own
   * without also exposing the action on every row.
   */
  showEscalate?: boolean | ((priority: PriorityRow) => boolean);
  onEscalate?: (id: number) => void;
  showMarkComplete?: boolean;
  onMarkComplete?: (id: number) => void;
  showDeptActions?: boolean;
  onAssign?: (id: number) => void;
  showReopen?: boolean;
  onReopen?: (id: number) => void;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  emptyMessage: string;
  emptyAction?: React.ReactNode;
  density?: PriorityListDensity;
  /**
   * When true, the empty state changes from "Nothing exists" to
   * "Filters are hiding everything" with a Clear filters action. Pass
   * the page's active-filter flag so the message stays honest.
   */
  filtersActive?: boolean;
  onClearFilters?: () => void;
}

export function PriorityListSection({
  priorities,
  isLoading,
  isError,
  error,
  refetch,
  showEscalate,
  onEscalate,
  showMarkComplete,
  onMarkComplete,
  showDeptActions,
  onAssign,
  showReopen,
  onReopen,
  selectable,
  selectedIds,
  onToggleSelect,
  emptyMessage,
  emptyAction,
  density = "cards",
  filtersActive,
  onClearFilters,
}: PriorityListSectionProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
        <p className="text-sm font-medium text-red-600 mb-1">Failed to load priorities</p>
        <p className="text-xs text-muted-foreground mb-3">{error?.message || "Unknown error"}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="w-3 h-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const escalated = priorities.filter((p) => p.escalated);
  const normal = priorities.filter((p) => !p.escalated);

  const renderCard = (p: PriorityRow) => (
    <PriorityCard
      key={p.id}
      priority={p}
      density={density}
      showEscalate={typeof showEscalate === "function" ? showEscalate(p) : showEscalate}
      onEscalate={() => onEscalate?.(p.id)}
      showMarkComplete={showMarkComplete}
      onMarkComplete={() => onMarkComplete?.(p.id)}
      showDeptActions={showDeptActions}
      onAssign={() => onAssign?.(p.id)}
      showReopen={showReopen}
      onReopen={() => onReopen?.(p.id)}
      selectable={selectable}
      selected={selectedIds?.has(p.id)}
      onToggleSelect={() => onToggleSelect?.(p.id)}
    />
  );

  // Layout: cards uses a 2-column grid with comfortable spacing,
  // dense is a single stacked list of one-line strips for max scan
  // speed on larger queues.
  const gridClass =
    density === "dense"
      ? "flex flex-col gap-1"
      : "grid grid-cols-1 md:grid-cols-2 gap-3";

  return (
    <div>
      {/* Quiet affordance that multi-select exists. Only shown when
          (a) the list is selectable for this user, (b) the list has
          rows, and (c) nothing is currently selected. Once the user
          selects something the floating bulk-action bar is enough. */}
      {selectable && priorities.length > 0 && (!selectedIds || selectedIds.size === 0) && (
        <p className="text-[11px] text-muted-foreground mb-2" data-testid="bulk-hint">
          Tip: tick the checkboxes on cards to act on multiple priorities at once.
        </p>
      )}
      {escalated.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-red-600 uppercase flex items-center gap-1 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Escalations ({escalated.length})
          </h3>
          <div className={gridClass}>
            {escalated.map(renderCard)}
          </div>
        </div>
      )}

      {normal.length === 0 && escalated.length === 0 ? (
        // Empty state branches on whether filters are hiding the data.
        // When filters are active we say so explicitly and offer a one-
        // click reset, so the operator can't read "nothing here" as
        // "this department has no priorities" when really their Critical
        // health filter just hid the only priority.
        filtersActive ? (
          <div className="text-center py-12 px-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 border border-amber-200 mb-3">
              <Flag className="w-5 h-5 text-amber-600" />
            </div>
            <p className="text-base font-medium text-foreground mb-1">No priorities match the current filters</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
              Clear filters to see everything in this scope, or refine the criteria.
            </p>
            {onClearFilters && (
              <Button variant="outline" size="sm" onClick={onClearFilters} data-testid="empty-clear-filters">
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="text-center py-16 px-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 mb-4">
              <Flag className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="text-base font-medium text-foreground mb-1">{emptyMessage}</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
              A priority is a single, named thing the team needs to make progress on this week / month / quarter — owner, due date, definition-of-done.
            </p>
            {emptyAction}
          </div>
        )
      ) : normal.length > 0 ? (
        <div className={gridClass}>
          {normal.map(renderCard)}
        </div>
      ) : null}
    </div>
  );
}
