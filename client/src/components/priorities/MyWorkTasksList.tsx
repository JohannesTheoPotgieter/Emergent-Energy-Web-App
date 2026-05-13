/**
 * MyWorkTasksList — renders the "tasks" half of the unified My-Work feed
 * served by GET /api/priorities/my-work.
 *
 * Splits the task array into two sub-sections:
 *   • Personal Tasks (bucket='personal' / workstream='PERSONAL' / no project)
 *     → full CRUD: status update, mark complete, delete, promote to priority
 *   • Project Tasks (everything else)
 *     → status update + promote only (no delete; task belongs to a project)
 *
 * Each row exposes a "Promote to priority" action that calls
 * POST /api/priorities/from-task/:workItemId — the resulting priority joins
 * the priorities list above and the task disappears from this list on the
 * next refetch (suppressed via linkedTaskId).
 *
 * Layout mirrors PriorityCard: same card width, same left-border colour
 * convention (severity / urgency), same due-date affordance.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowUp,
  Briefcase,
  CheckCircle2,
  Circle,
  Clock,
  ListTodo,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MyWorkTaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueDate: string | null;
  startDate: string | null;
  projectId: number | null;
  projectName: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  workstream: string;
  source: string;
  taskCategory: string | null;
  bucket: string | null;
  percentComplete: number;
  /** Canonical red/amber/green health signal from work_items.trackingRag. */
  trackingRag: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Phase 7C: task ↔ level/health mapping. The /priorities filter chips use
// `level` ∈ {all, critical, important, normal} and `health` ∈ {all, critical,
// at_risk, healthy}. work_items don't have those exact columns, so we project:
//
//   level   <- work_item.priority
//     "critical" → "critical"
//     "high"     → "important"
//     anything else (normal, low, null) → "normal"
//
//   health  <- work_item.trackingRag (canonical) with status fallback
//     "red" or status="blocked"            → "critical"
//     "amber" or overdue (dueDate < today) → "at_risk"
//     "green" or anything else             → "healthy"
// =============================================================================

export type TaskLevel = "critical" | "important" | "normal";
export type TaskHealth = "critical" | "at_risk" | "healthy";

export function taskLevel(task: { priority: string | null }): TaskLevel {
  const p = (task.priority ?? "").toLowerCase();
  if (p === "critical") return "critical";
  if (p === "high") return "important";
  return "normal";
}

export function taskHealth(task: {
  trackingRag: string | null;
  status: string;
  dueDate: string | null;
}): TaskHealth {
  const rag = (task.trackingRag ?? "").toLowerCase();
  if (rag === "red") return "critical";
  const status = (task.status ?? "").toLowerCase();
  if (status === "blocked" || status === "block") return "critical";
  if (rag === "amber" || rag === "yellow") return "at_risk";
  if (task.dueDate) {
    const due = Date.parse(task.dueDate + "T00:00:00Z");
    const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    if (!Number.isNaN(due) && !Number.isNaN(today) && due < today) {
      const isDone =
        status === "complete" || status === "completed" || status === "done";
      if (!isDone) return "at_risk";
    }
  }
  return "healthy";
}

/** True when a task is "personal" — no project, or explicitly personal bucket/workstream. */
export function isPersonalTask(t: MyWorkTaskRow): boolean {
  return (
    t.bucket === "personal" ||
    t.workstream === "PERSONAL" ||
    (!t.projectId && !t.projectName)
  );
}

const PRIORITY_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-amber-500",
  normal: "border-l-slate-300",
  low: "border-l-slate-200",
};

const TASK_STATUSES = [
  "Not Started",
  "In Progress",
  "Complete",
  "Blocked",
  "Cancelled",
] as const;

const STATUS_BADGE_CLASS: Record<string, string> = {
  "not started":  "bg-slate-100 text-slate-600",
  "in progress":  "bg-blue-100 text-blue-700",
  "complete":     "bg-emerald-100 text-emerald-700",
  "completed":    "bg-emerald-100 text-emerald-700",
  "done":         "bg-emerald-100 text-emerald-700",
  "blocked":      "bg-red-100 text-red-700",
  "cancelled":    "bg-gray-100 text-gray-500 line-through",
};

function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = Date.parse(dateStr + "T00:00:00Z");
  const today = Date.parse(
    new Date().toISOString().slice(0, 10) + "T00:00:00Z",
  );
  if (Number.isNaN(due) || Number.isNaN(today)) return null;
  return Math.ceil((due - today) / 86_400_000);
}

export interface MyWorkTasksListProps {
  tasks: MyWorkTaskRow[];
  onPromote: (taskId: number) => Promise<void> | void;
  promotingId: number | null;
  onUpdateStatus?: (id: number, status: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
  updatingId?: number | null;
  deletingId?: number | null;
  emptyMessage?: string;
}

export function MyWorkTasksList({
  tasks,
  onPromote,
  promotingId,
  onUpdateStatus,
  onDelete,
  updatingId,
  deletingId,
  emptyMessage,
}: MyWorkTasksListProps) {
  const personal = tasks.filter(isPersonalTask);
  const projectTasks = tasks.filter((t) => !isPersonalTask(t));

  if (tasks.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-3 px-4 border rounded-lg bg-muted/20">
        {emptyMessage ?? "No outstanding tasks assigned to you."}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="my-work-tasks-list">
      {personal.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Personal Tasks ({personal.length})
          </p>
          {personal.map((t) => (
            <MyWorkTaskCard
              key={t.id}
              task={t}
              isPersonal
              onPromote={onPromote}
              isPromoting={promotingId === t.id}
              onUpdateStatus={onUpdateStatus}
              onDelete={onDelete}
              isUpdating={updatingId === t.id}
              isDeleting={deletingId === t.id}
            />
          ))}
        </div>
      )}

      {projectTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Project Tasks ({projectTasks.length})
          </p>
          {projectTasks.map((t) => (
            <MyWorkTaskCard
              key={t.id}
              task={t}
              isPersonal={false}
              onPromote={onPromote}
              isPromoting={promotingId === t.id}
              onUpdateStatus={onUpdateStatus}
              isUpdating={updatingId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MyWorkTaskCardProps {
  task: MyWorkTaskRow;
  isPersonal: boolean;
  onPromote: (taskId: number) => Promise<void> | void;
  isPromoting: boolean;
  onUpdateStatus?: (id: number, status: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
  isUpdating: boolean;
  isDeleting?: boolean;
}

function MyWorkTaskCard({
  task,
  isPersonal,
  onPromote,
  isPromoting,
  onUpdateStatus,
  onDelete,
  isUpdating,
  isDeleting,
}: MyWorkTaskCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const days = daysRemaining(task.dueDate);
  const isOverdue = days !== null && days < 0;
  const statusKey = String(task.status || "").toLowerCase();
  const isDone =
    statusKey === "complete" || statusKey === "completed" || statusKey === "done";

  const borderClass =
    isOverdue
      ? "border-l-red-500"
      : (PRIORITY_BORDER[String(task.priority || "normal").toLowerCase()] ??
          "border-l-slate-300");

  const statusBadgeClass =
    STATUS_BADGE_CLASS[statusKey] ?? "bg-slate-100 text-slate-600";

  return (
    <Card
      className={`border-l-4 ${borderClass} ${isDeleting ? "opacity-50" : ""}`}
      data-testid={`my-work-task-${task.id}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Quick-complete toggle */}
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-40"
            title={isDone ? "Mark incomplete" : "Mark complete"}
            disabled={isUpdating || isDeleting}
            onClick={() =>
              onUpdateStatus?.(
                task.id,
                isDone ? "Not Started" : "Complete",
              )
            }
            aria-label={isDone ? "Mark incomplete" : "Mark complete"}
          >
            {isDone ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <Circle className="h-4 w-4" />
            )}
          </button>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <ListTodo className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span
                className={`text-sm font-medium truncate ${isDone ? "line-through text-muted-foreground" : ""}`}
              >
                {task.title}
              </span>
              {isPersonal && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide text-sky-700 border-sky-200 bg-sky-50"
                >
                  personal
                </Badge>
              )}
            </div>

            {task.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {task.description}
              </p>
            )}

            <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
              {/* Status badge — clickable dropdown for status update */}
              {onUpdateStatus ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isUpdating || isDeleting}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium cursor-pointer hover:opacity-80 disabled:opacity-40 ${statusBadgeClass}`}
                      aria-label="Change task status"
                    >
                      {isUpdating ? "Updating…" : (task.status || "Not Started")}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[140px]">
                    {TASK_STATUSES.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        className={`text-xs ${s.toLowerCase() === statusKey ? "font-semibold" : ""}`}
                        onSelect={() => onUpdateStatus(task.id, s)}
                      >
                        {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass}`}
                >
                  {task.status || "Not Started"}
                </span>
              )}

              {task.projectName && task.projectId && (
                <Link
                  href={`/project/id/${task.projectId}`}
                  className="inline-flex items-center gap-1 hover:underline"
                  data-testid={`my-work-task-${task.id}-project`}
                >
                  <Briefcase className="h-3 w-3" />
                  {task.projectName}
                </Link>
              )}

              {task.dueDate && (
                <span
                  className={`inline-flex items-center gap-1 ${isOverdue ? "text-red-600 font-medium" : ""}`}
                >
                  <Clock className="h-3 w-3" />
                  due {task.dueDate}
                  {days !== null && (
                    <span className="ml-1">
                      (
                      {days < 0
                        ? `${Math.abs(days)}d overdue`
                        : days === 0
                          ? "today"
                          : `${days}d`}
                      )
                    </span>
                  )}
                </span>
              )}

              {typeof task.percentComplete === "number" &&
                task.percentComplete > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {Math.round(task.percentComplete)}%
                  </span>
                )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="shrink-0 flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={isPromoting || isUpdating || isDeleting}
              onClick={() => void onPromote(task.id)}
              title="Promote this task to a personal priority — it joins your My Priorities list and gains the escalate chain."
              data-testid={`my-work-task-${task.id}-promote`}
            >
              <ArrowUp className="h-3 w-3 mr-1" />
              {isPromoting ? "Promoting…" : "Make priority"}
            </Button>

            {isPersonal && onDelete && (
              confirmDelete ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  disabled={isDeleting}
                  onClick={() => { setConfirmDelete(false); void onDelete(task.id); }}
                  title="Confirm delete"
                  data-testid={`my-work-task-${task.id}-confirm-delete`}
                >
                  {isDeleting ? "…" : "Delete?"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                  disabled={isDeleting}
                  onClick={() => setConfirmDelete(true)}
                  title="Delete this personal task"
                  data-testid={`my-work-task-${task.id}-delete`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
