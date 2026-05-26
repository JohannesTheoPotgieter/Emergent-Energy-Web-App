import { AlertCircle, AlertTriangle, Flag, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PriorityRow } from "@/lib/priority-types";
import { PriorityCard } from "./PriorityCard";

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

  return (
    <div>
      {escalated.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-red-600 uppercase flex items-center gap-1 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Escalations ({escalated.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {escalated.map(renderCard)}
          </div>
        </div>
      )}

      {normal.length === 0 && escalated.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Flag className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground mb-1">{emptyMessage}</p>
          {emptyAction}
        </div>
      ) : normal.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {normal.map(renderCard)}
        </div>
      ) : null}
    </div>
  );
}
