/**
 * Small shared list/card affordances for the engineering spine task surfaces:
 *   - SubtaskChip      — done/total roll-up from the spine list response
 *   - AssigneeStack    — overlapping avatar stack (owner-first names)
 *
 * Used by engineering-task-views.tsx (List) and engineering-task-cards.tsx
 * (Kanban cards). Kept tiny and prop-driven; no data fetching here.
 */
import { ListTree } from "lucide-react";
import { getAvatarColor, getInitials } from "@/lib/task-formatters";

export function SubtaskChip({ total, done }: { total: number; done: number }) {
  if (!total) return null;
  const complete = done >= total;
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[9px] font-medium " +
        (complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border bg-muted/40 text-muted-foreground")
      }
      title={`${done} of ${total} subtasks complete`}
      data-testid="subtask-chip"
    >
      <ListTree className="h-2.5 w-2.5" />
      {done}/{total}
    </span>
  );
}

export function AssigneeStack({ names, max = 3 }: { names: string[]; max?: number }) {
  if (names.length === 0) {
    return <span className="text-[10px] italic text-muted-foreground/50">Unassigned</span>;
  }
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center" data-testid="assignee-stack">
      <div className="flex -space-x-1">
        {shown.map((name, i) => (
          <div
            key={`${name}-${i}`}
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-card ${getAvatarColor(name)}`}
            title={name}
          >
            {getInitials(name)}
          </div>
        ))}
        {extra > 0 ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-300 text-[8px] font-bold text-muted-foreground ring-1 ring-card">
            +{extra}
          </div>
        ) : null}
      </div>
    </div>
  );
}
